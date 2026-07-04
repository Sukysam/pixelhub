from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any, Literal, cast
from urllib.parse import urljoin

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.mail import EmailMessage
from django.template.loader import get_template
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .finance_services import invoice_discount_context
from .models import DocumentDelivery, Invoice, Receipt, SavedDocument
from .rendering_service import (
    currency_for_code,
    detect_country,
    effective_company_identity_for_user,
    effective_logo_assets_for_user,
    effective_region_settings_for_user,
    effective_templates_for_user,
    format_date_for_pattern,
    format_money,
)

DocumentFormat = Literal["pdf", "html", "text"]
DocumentType = Literal["invoice", "receipt"]
DeliveryChannel = Literal["print", "email", "share"]


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
E164_RE = re.compile(r"^\+[1-9]\d{9,14}$")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RenderedDocument:
    filename: str
    content_type: str
    content: bytes
    backend: str | None = None


def validate_email(value: str) -> str:
    v = (value or "").strip()
    if not v or not EMAIL_RE.match(v):
        raise ValidationError({"to_email": "Invalid email address"})
    return v


def normalize_phone_e164(value: str) -> str:
    v = (value or "").strip().replace(" ", "").replace("-", "")
    if not v.startswith("+"):
        if v.startswith("0"):
            v = v.lstrip("0")
        v = "+" + v
    if not E164_RE.match(v):
        raise ValidationError({"to_phone": "Phone number must be in E.164 format (e.g. +2348012345678)"})
    return v


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_download_token(ttl_minutes: int = 60) -> tuple[str, str, Any]:
    token = secrets.token_urlsafe(32)
    token_hash = _token_hash(token)
    expires_at = timezone.now() + timedelta(minutes=max(1, int(ttl_minutes)))
    return token, token_hash, expires_at


def verify_download_token(token: str, token_hash: str) -> bool:
    if not token or not token_hash:
        return False
    calc = _token_hash(token)
    return hmac.compare_digest(calc, token_hash)


def _absolute_media_url(request, value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://", "data:")):
        return raw
    if raw.startswith("//"):
        base = backend_public_base_url()
        try:
            scheme = (request.build_absolute_uri("/") if hasattr(request, "build_absolute_uri") else base).split(":", 1)[0]
        except Exception:
            scheme = "https"
        return f"{scheme}:{raw}"
    if raw.startswith("/"):
        builder = getattr(request, "build_absolute_uri", None)
        if callable(builder):
            try:
                return builder(raw)
            except Exception:
                pass
        return urljoin(backend_public_base_url().rstrip("/") + "/", raw.lstrip("/"))
    return raw


def _embedded_file_data_url(field_file, content_type: str | None) -> str | None:
    if not getattr(field_file, "name", None):
        return None
    storage = getattr(field_file, "storage", None)
    if storage is None:
        return None
    try:
        with storage.open(field_file.name, "rb") as fh:
            raw = fh.read()
    except Exception:
        logger.warning("document.logo_read_failed file=%s", getattr(field_file, "name", None), exc_info=True)
        return None
    if not raw:
        return None
    mime = str(content_type or "").strip() or "application/octet-stream"
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _embedded_logo_data_url(asset) -> str | None:
    if asset is None:
        return None
    primary = _embedded_file_data_url(getattr(asset, "file", None), getattr(asset, "content_type", None))
    if primary:
        return primary
    return _embedded_file_data_url(getattr(asset, "thumbnail", None), "image/png")


class _TemplateContext(dict):
    def __missing__(self, key):
        return ""


def _render_template_string(template: str | None, context: dict[str, Any], *, field_name: str, default: str) -> str:
    raw = str(template or "").strip()
    source = raw or default
    try:
        return source.format_map(_TemplateContext(context)).strip()
    except KeyError as exc:
        raise ValidationError({field_name: f"Unknown placeholder: {exc.args[0]}"}) from exc
    except ValueError as exc:
        raise ValidationError({field_name: "Invalid template format"}) from exc


def _document_context_for_delivery(delivery: DocumentDelivery, token: str | None = None) -> dict[str, Any]:
    identity = effective_company_identity_for_user(delivery.user)
    download_url = None
    if token:
        download_url = f"{backend_public_base_url()}/api/documents/deliveries/{delivery.id}/download/?token={token}"
    if delivery.document_type == "invoice":
        invoice = cast(Invoice, delivery.invoice)
        return {
            "company_name": identity["company_name"] or "PIXELHUB",
            "document_type": "invoice",
            "document_label": "Invoice",
            "document_number": invoice.invoice_number,
            "customer_name": invoice.customer.name,
            "customer_email": invoice.customer.email or "",
            "total_amount": str(invoice.total_amount),
            "issue_date": str(invoice.issue_date or ""),
            "due_date": str(invoice.due_date or ""),
            "download_url": download_url or "",
        }
    receipt = cast(Receipt, delivery.receipt)
    return {
        "company_name": identity["company_name"] or "PIXELHUB",
        "document_type": "receipt",
        "document_label": "Receipt",
        "document_number": f"RCPT-{receipt.id}",
        "customer_name": receipt.invoice.customer.name,
        "customer_email": receipt.invoice.customer.email or "",
        "total_amount": str(receipt.amount_paid),
        "issue_date": str(receipt.payment_date or ""),
        "due_date": "",
        "download_url": download_url or "",
    }


def _resolved_document_templates(request, user) -> dict[str, dict[str, Any]]:
    templates = effective_templates_for_user(user)
    assets = effective_logo_assets_for_user(user)
    global_appearance = dict(templates.get("global_appearance") or {})
    invoice_template = dict(templates.get("invoice_template") or {})
    receipt_template = dict(templates.get("receipt_template") or {})

    for key, bucket in (
        ("global_appearance", global_appearance),
        ("invoice_template", invoice_template),
        ("receipt_template", receipt_template),
    ):
        bucket["logo_url"] = _absolute_media_url(request, bucket.get("logo_url"))
        bucket["logo_thumbnail_url"] = _absolute_media_url(request, bucket.get("logo_thumbnail_url"))
        bucket["logo_embedded_url"] = _embedded_logo_data_url(assets.get(key))

    invoice_template["layout"] = (
        invoice_template.get("layout")
        if invoice_template.get("layout") in {"classic", "compact"}
        else "classic"
    )
    receipt_template["layout"] = (
        receipt_template.get("layout")
        if receipt_template.get("layout") in {"classic", "compact"}
        else "classic"
    )
    return {
        "global_appearance": global_appearance,
        "invoice_template": invoice_template,
        "receipt_template": receipt_template,
    }


def _invoice_render_settings(templates: dict[str, dict[str, Any]]) -> dict[str, Any]:
    invoice_template = templates.get("invoice_template") or {}
    global_appearance = templates.get("global_appearance") or {}
    return {
        "layout": invoice_template.get("layout") or "classic",
        "primary_color": invoice_template.get("primary_color") or global_appearance.get("primary_color") or "#1a4d8e",
        "font_family": invoice_template.get("font_family") or global_appearance.get("font_family") or "Helvetica",
        "logo_src": invoice_template.get("logo_embedded_url")
        or global_appearance.get("logo_embedded_url")
        or invoice_template.get("logo_url")
        or global_appearance.get("logo_url"),
        "logo_url": invoice_template.get("logo_url") or global_appearance.get("logo_url"),
        "footer_text": invoice_template.get("footer_text")
        or global_appearance.get("invoice_footer_text")
        or "Thank you for your business!",
        "show_item_description": bool(invoice_template.get("show_item_description")),
    }


def _receipt_render_settings(templates: dict[str, dict[str, Any]]) -> dict[str, Any]:
    receipt_template = templates.get("receipt_template") or {}
    global_appearance = templates.get("global_appearance") or {}
    return {
        "layout": receipt_template.get("layout") or "classic",
        "primary_color": receipt_template.get("primary_color") or global_appearance.get("primary_color") or "#1a4d8e",
        "font_family": receipt_template.get("font_family") or global_appearance.get("font_family") or "Helvetica",
        "logo_src": receipt_template.get("logo_embedded_url")
        or global_appearance.get("logo_embedded_url")
        or receipt_template.get("logo_url")
        or global_appearance.get("logo_url"),
        "logo_url": receipt_template.get("logo_url") or global_appearance.get("logo_url"),
        "header_text": receipt_template.get("header_text") or "Receipt",
        "footer_text": receipt_template.get("footer_text")
        or global_appearance.get("receipt_footer_text")
        or "Thank you!",
        "show_items": receipt_template.get("show_items") if "show_items" in receipt_template else True,
        "show_item_description": receipt_template.get("show_item_description")
        if "show_item_description" in receipt_template
        else False,
    }


def render_invoice(request, invoice: Invoice, fmt: DocumentFormat) -> RenderedDocument:
    templates = _resolved_document_templates(request, request.user)
    invoice_render = _invoice_render_settings(templates)
    identity = effective_company_identity_for_user(request.user)
    region = effective_region_settings_for_user(request, request.user, detect_country=detect_country)
    currency = currency_for_code(region["currency_code"])
    symbol_position = (templates.get("invoice_template") or {}).get("currency_symbol_position") or "prefix"

    invoice_items = list(invoice.invoice_items.select_related("item").filter(is_deleted=False))
    rendered_items = []
    for li in invoice_items:
        rendered_items.append(
            {
                "name": li.item.name,
                "description": li.description or li.item.description,
                "unit_of_measure": li.unit_of_measure,
                "quantity": li.quantity,
                "unit_price": format_money(Decimal(li.unit_price), currency, region["number_format"], symbol_position),
                "line_total": format_money(Decimal(li.line_total), currency, region["number_format"], symbol_position),
                "line_tax": format_money(Decimal(li.line_tax), currency, region["number_format"], symbol_position),
                "line_subtotal": format_money(Decimal(li.line_subtotal), currency, region["number_format"], symbol_position),
            }
        )

    template = get_template("core/invoice_pdf.html")
    discount_context = invoice_discount_context(
        invoice,
        currency,
        region["number_format"],
        symbol_position,
        format_money=format_money,
    )
    html = template.render(
        {
            "invoice": invoice,
            "invoice_items": rendered_items,
            "issue_date_fmt": format_date_for_pattern(invoice.issue_date, region["date_format"]),
            "due_date_fmt": format_date_for_pattern(invoice.due_date, region["date_format"]) if invoice.due_date else None,
            "subtotal_fmt": format_money(Decimal(invoice.subtotal), currency, region["number_format"], symbol_position),
            **discount_context,
            "tax_total_fmt": format_money(Decimal(invoice.tax_total), currency, region["number_format"], symbol_position),
            "total_amount_fmt": format_money(Decimal(invoice.total_amount), currency, region["number_format"], symbol_position),
            "currency_code": currency.code if currency else region["currency_code"],
            "invoice_render": invoice_render,
            **templates,
        }
    )

    if fmt == "html":
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="html",
        )

    if fmt == "text":
        lines = [
            identity["company_name"] or "PIXELHUB",
            f"INVOICE {invoice.invoice_number}",
            f"Customer: {invoice.customer.name}",
            f"Issue date: {invoice.issue_date}",
            f"Due date: {invoice.due_date or ''}",
            f"Subtotal: {invoice.subtotal}",
        ]
        if discount_context["has_discount"]:
            lines.append(f"Discount {discount_context['discount_summary_label']}: -{invoice.discount_amount}")
        lines.extend(
            [
            f"Tax total: {invoice.tax_total}",
            f"Total: {invoice.total_amount}",
            "",
            ]
        )
        for li in invoice_items:
            lines.append(f"- {li.item.name} x{li.quantity}: {li.line_total}")
        body = "\n".join(lines).strip() + "\n"
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.txt",
            content_type="text/plain; charset=utf-8",
            content=body.encode("utf-8"),
            backend="text",
        )

    try:
        from weasyprint import HTML
    except (ImportError, OSError):
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="unavailable",
        )
    try:
        pdf = HTML(string=html, base_url=backend_public_base_url()).write_pdf()
    except (OSError, ValueError):
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="failed",
        )
    return RenderedDocument(
        filename=f"invoice_{invoice.invoice_number}.pdf",
        content_type="application/pdf",
        content=cast(bytes, pdf),
        backend="weasyprint",
    )


def render_receipt(request, receipt: Receipt, fmt: DocumentFormat) -> RenderedDocument:
    templates = _resolved_document_templates(request, request.user)
    receipt_render = _receipt_render_settings(templates)
    identity = effective_company_identity_for_user(request.user)
    region = effective_region_settings_for_user(request, request.user, detect_country=detect_country)
    currency = currency_for_code(region["currency_code"])
    symbol_position = (templates.get("receipt_template") or {}).get("currency_symbol_position") or "prefix"

    rt = templates.get("receipt_template") or {}
    numbering_format = rt.get("numbering_format") or "RCPT-{id}"
    try:
        receipt_number = numbering_format.format(id=receipt.id, invoice_number=receipt.invoice.invoice_number)
    except Exception:
        receipt_number = f"RCPT-{receipt.id}"

    invoice = receipt.invoice
    line_items = list(invoice.invoice_items.select_related("item").filter(is_deleted=False))
    rendered_items = []
    for li in line_items:
        rendered_items.append(
            {
                "name": li.item.name,
                "description": li.description or li.item.description,
                "quantity": li.quantity,
                "unit_price": format_money(Decimal(li.unit_price), currency, region["number_format"], symbol_position),
                "line_total": format_money(Decimal(li.line_total), currency, region["number_format"], symbol_position),
            }
        )

    template = get_template("core/receipt_print.html")
    html = template.render(
        {
            "receipt": receipt,
            "receipt_number": receipt_number,
            "payment_date_fmt": format_date_for_pattern(receipt.payment_date, region["date_format"]),
            "amount_paid_fmt": format_money(Decimal(receipt.amount_paid), currency, region["number_format"], symbol_position),
            "invoice_total_fmt": format_money(Decimal(invoice.total_amount), currency, region["number_format"], symbol_position),
            "invoice_items": rendered_items,
            "receipt_render": receipt_render,
            **templates,
        }
    )

    if fmt == "html":
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="html",
        )

    if fmt == "text":
        lines = [
            identity["company_name"] or "PIXELHUB",
            f"RECEIPT RCPT-{receipt.id}",
            f"Invoice: {receipt.invoice.invoice_number}",
            f"Date: {receipt.payment_date}",
            f"Customer: {receipt.invoice.customer.name}",
            f"Amount paid: {receipt.amount_paid}",
            f"Method: {receipt.payment_method}",
            f"Reference: {receipt.reference_number or ''}",
        ]
        body = "\n".join(lines).strip() + "\n"
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.txt",
            content_type="text/plain; charset=utf-8",
            content=body.encode("utf-8"),
            backend="text",
        )

    try:
        from weasyprint import HTML
    except (ImportError, OSError):
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="unavailable",
        )
    try:
        pdf = HTML(string=html, base_url=backend_public_base_url()).write_pdf()
    except (OSError, ValueError):
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
            backend="failed",
        )
    return RenderedDocument(
        filename=f"receipt_{receipt.id}.pdf",
        content_type="application/pdf",
        content=cast(bytes, pdf),
        backend="weasyprint",
    )


def backend_public_base_url() -> str:
    v = str(getattr(settings, "BACKEND_PUBLIC_BASE_URL", "") or "").strip()
    return v or "http://127.0.0.1:8000"


def create_delivery(
    *,
    user,
    document_type: DocumentType,
    document_id: int,
    channel: DeliveryChannel,
    fmt: DocumentFormat,
    to_email: str | None = None,
    to_phone: str | None = None,
    ttl_minutes: int = 60,
    metadata: dict[str, Any] | None = None,
) -> tuple[DocumentDelivery, str | None]:
    if channel not in ("print", "email", "share"):
        raise ValidationError({"channel": "Invalid channel"})
    if fmt not in ("pdf", "html", "text"):
        raise ValidationError({"format": "Invalid format"})
    if channel == "email":
        if not to_email:
            raise ValidationError({"to_email": "to_email is required"})
        to_email = validate_email(to_email)

    invoice = None
    receipt = None
    if document_type == "invoice":
        invoice = Invoice.objects.filter(pk=document_id, is_deleted=False).select_related("customer").first()
        if invoice is None:
            raise ValidationError({"document_id": "Invoice not found"})
    elif document_type == "receipt":
        receipt = Receipt.objects.filter(pk=document_id, is_deleted=False).select_related("invoice", "invoice__customer").first()
        if receipt is None:
            raise ValidationError({"document_id": "Receipt not found"})
    else:
        raise ValidationError({"document_type": "Invalid document_type"})

    token = None
    token_hash = None
    expires_at = None
    if channel in ("email", "share"):
        token, token_hash, expires_at = create_download_token(ttl_minutes=ttl_minutes)

    delivery = DocumentDelivery.objects.create(
        user=user,
        document_type=document_type,
        invoice=invoice,
        receipt=receipt,
        channel=channel,
        format=fmt,
        to_email=to_email,
        to_phone=to_phone,
        status="sent" if channel == "share" else "queued",
        download_token_hash=token_hash,
        download_expires_at=expires_at,
        metadata=metadata or {},
    )
    return delivery, token


def _send_email(*, subject: str, to_email: str, body_text: str, body_html: str | None, attachment: RenderedDocument | None) -> None:
    msg = EmailMessage(subject=subject, body=body_html if body_html else body_text, from_email=settings.DEFAULT_FROM_EMAIL, to=[to_email])
    if body_html:
        msg.content_subtype = "html"
    if attachment is not None:
        msg.attach(attachment.filename, attachment.content, attachment.content_type)
    msg.send(fail_silently=False)


def send_delivery(request, delivery: DocumentDelivery, token: str | None) -> DocumentDelivery:
    if delivery.status in ("sent", "cancelled"):
        return delivery
    if delivery.channel == "print":
        printer_name = str((delivery.metadata or {}).get("printer_name") or "").strip()
        if not printer_name:
            delivery.status = "sent"
            delivery.attempt_count = (delivery.attempt_count or 0) + 1
            delivery.last_attempt_at = timezone.now()
            delivery.next_retry_at = None
            delivery.last_error_code = None
            delivery.last_error_message = None
            delivery.save(update_fields=["status", "attempt_count", "last_attempt_at", "next_retry_at", "last_error_code", "last_error_message", "updated_at"])
            return delivery

        import subprocess
        import tempfile

        if delivery.document_type == "invoice":
            doc = render_invoice(request, cast(Invoice, delivery.invoice), "pdf")
        else:
            doc = render_receipt(request, cast(Receipt, delivery.receipt), "pdf")
        if not doc.content_type.startswith("application/pdf"):
            raise ValidationError({"detail": "Printing requires PDF output"})
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as f:
            f.write(doc.content)
            f.flush()
            proc = subprocess.run(["lp", "-d", printer_name, f.name], capture_output=True, text=True, timeout=15, check=False)
            if proc.returncode != 0:
                raise ValidationError({"detail": "Printing failed"})
            job_id = (proc.stdout or "").strip() or None
        if job_id:
            delivery.provider_message_id = job_id
        delivery.status = "sent"
        delivery.attempt_count = (delivery.attempt_count or 0) + 1
        delivery.last_attempt_at = timezone.now()
        delivery.next_retry_at = None
        delivery.last_error_code = None
        delivery.last_error_message = None
        delivery.save(update_fields=["provider_message_id", "status", "attempt_count", "last_attempt_at", "next_retry_at", "last_error_code", "last_error_message", "updated_at"])
        return delivery

    if delivery.channel == "email":
        if not delivery.to_email:
            raise ValidationError({"to_email": "to_email is required"})
        if delivery.document_type == "invoice":
            doc = render_invoice(request, cast(Invoice, delivery.invoice), cast(DocumentFormat, delivery.format))
        else:
            doc = render_receipt(request, cast(Receipt, delivery.receipt), cast(DocumentFormat, delivery.format))
        if not token and delivery.download_token_hash:
            token, token_hash, expires_at = create_download_token(ttl_minutes=60)
            delivery.download_token_hash = token_hash
            delivery.download_expires_at = expires_at
            delivery.save(update_fields=["download_token_hash", "download_expires_at", "updated_at"])
        context = _document_context_for_delivery(delivery, token)
        subject = _render_template_string(
            str((delivery.metadata or {}).get("email_subject_template") or ""),
            context,
            field_name="email_subject_template",
            default="{document_label} {document_number}",
        )
        body_text = _render_template_string(
            str((delivery.metadata or {}).get("email_message_template") or ""),
            context,
            field_name="email_message_template",
            default=(
                "Hello {customer_name},\n\n"
                "Please find your {document_type} attached from {company_name}."
                "\n\nDownload link: {download_url}\n"
            ),
        )
        body_html = None
        attachment = doc if delivery.format == "pdf" else None
        if delivery.format in ("html", "text"):
            attachment = doc
        _send_email(subject=subject, to_email=delivery.to_email, body_text=body_text, body_html=body_html, attachment=attachment)
        delivery.status = "sent"
        delivery.attempt_count = (delivery.attempt_count or 0) + 1
        delivery.last_attempt_at = timezone.now()
        delivery.next_retry_at = None
        delivery.last_error_code = None
        delivery.last_error_message = None
        delivery.save(update_fields=["status", "attempt_count", "last_attempt_at", "next_retry_at", "last_error_code", "last_error_message", "updated_at"])
        return delivery

    raise ValidationError({"channel": "Invalid channel"})


def save_document_backup(
    request,
    *,
    user,
    document_type: DocumentType,
    document_id: int,
    metadata: dict[str, Any] | None = None,
) -> SavedDocument:
    if document_type == "invoice":
        invoice = Invoice.objects.filter(pk=document_id, is_deleted=False).select_related("customer").first()
        if invoice is None:
            raise ValidationError({"document_id": "Invoice not found"})
        receipt = None
        rendered = render_invoice(request, invoice, "pdf")
    elif document_type == "receipt":
        receipt = Receipt.objects.filter(pk=document_id, is_deleted=False).select_related("invoice", "invoice__customer").first()
        if receipt is None:
            raise ValidationError({"document_id": "Receipt not found"})
        invoice = None
        rendered = render_receipt(request, receipt, "pdf")
    else:
        raise ValidationError({"document_type": "Invalid document_type"})
    if not rendered.content_type.startswith("application/pdf"):
        raise ValidationError({"detail": "PDF generation failed for this document"})

    saved = SavedDocument(
        user=user,
        document_type=document_type,
        invoice=invoice,
        receipt=receipt,
        format="pdf",
        original_filename=rendered.filename,
        content_type=rendered.content_type,
        sha256=hashlib.sha256(rendered.content).hexdigest(),
        size_bytes=len(rendered.content),
        storage_backend="",
        metadata=metadata or {},
    )
    saved.file.save(rendered.filename, ContentFile(rendered.content), save=False)
    saved.storage_backend = saved.file.storage.__class__.__name__
    saved.save()
    return saved
