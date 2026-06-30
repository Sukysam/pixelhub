from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any, Literal, cast

from django.conf import settings
from django.core.cache import cache
from django.core.mail import EmailMessage
from django.template.loader import get_template
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import DocumentDelivery, Invoice, Receipt

DocumentFormat = Literal["pdf", "html", "text"]
DocumentType = Literal["invoice", "receipt"]
DeliveryChannel = Literal["print", "email", "share"]


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
E164_RE = re.compile(r"^\+[1-9]\d{9,14}$")


@dataclass(frozen=True)
class RenderedDocument:
    filename: str
    content_type: str
    content: bytes


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


def render_invoice(request, invoice: Invoice, fmt: DocumentFormat) -> RenderedDocument:
    from .views import (
        _currency_for_code,
        _effective_company_identity_for_user,
        _effective_region_settings_for_user,
        _effective_templates_for_user,
        _format_date_for_pattern,
        _invoice_discount_context,
        _format_money,
    )
    templates = _effective_templates_for_user(request.user)
    identity = _effective_company_identity_for_user(request.user)
    region = _effective_region_settings_for_user(request, request.user)
    currency = _currency_for_code(region["currency_code"])
    symbol_position = (templates.get("invoice_template") or {}).get("currency_symbol_position") or "prefix"

    invoice_items = list(invoice.invoice_items.select_related("item").filter(is_deleted=False))
    rendered_items = []
    for li in invoice_items:
        rendered_items.append(
            {
                "name": li.item.name,
                "description": li.description,
                "unit_of_measure": li.unit_of_measure,
                "quantity": li.quantity,
                "unit_price": _format_money(Decimal(li.unit_price), currency, region["number_format"], symbol_position),
                "line_total": _format_money(Decimal(li.line_total), currency, region["number_format"], symbol_position),
                "line_tax": _format_money(Decimal(li.line_tax), currency, region["number_format"], symbol_position),
                "line_subtotal": _format_money(Decimal(li.line_subtotal), currency, region["number_format"], symbol_position),
            }
        )

    template = get_template("core/invoice_pdf.html")
    discount_context = _invoice_discount_context(invoice, currency, region["number_format"], symbol_position)
    html = template.render(
        {
            "invoice": invoice,
            "invoice_items": rendered_items,
            "issue_date_fmt": _format_date_for_pattern(invoice.issue_date, region["date_format"]),
            "due_date_fmt": _format_date_for_pattern(invoice.due_date, region["date_format"]) if invoice.due_date else None,
            "subtotal_fmt": _format_money(Decimal(invoice.subtotal), currency, region["number_format"], symbol_position),
            **discount_context,
            "tax_total_fmt": _format_money(Decimal(invoice.tax_total), currency, region["number_format"], symbol_position),
            "total_amount_fmt": _format_money(Decimal(invoice.total_amount), currency, region["number_format"], symbol_position),
            "currency_code": currency.code if currency else region["currency_code"],
            **templates,
        }
    )

    if fmt == "html":
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
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
        )

    try:
        from weasyprint import HTML
    except (ImportError, OSError):
        return RenderedDocument(
            filename=f"invoice_{invoice.invoice_number}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
        )
    pdf = HTML(string=html).write_pdf()
    return RenderedDocument(
        filename=f"invoice_{invoice.invoice_number}.pdf",
        content_type="application/pdf",
        content=cast(bytes, pdf),
    )


def render_receipt(request, receipt: Receipt, fmt: DocumentFormat) -> RenderedDocument:
    from .views import (
        _currency_for_code,
        _effective_company_identity_for_user,
        _effective_region_settings_for_user,
        _effective_templates_for_user,
        _format_date_for_pattern,
        _format_money,
    )
    templates = _effective_templates_for_user(request.user)
    identity = _effective_company_identity_for_user(request.user)
    region = _effective_region_settings_for_user(request, request.user)
    currency = _currency_for_code(region["currency_code"])
    symbol_position = (templates.get("receipt_template") or {}).get("currency_symbol_position") or "prefix"

    rt = templates.get("receipt_template") or {}
    ga = templates.get("global_appearance") or {}
    primary = rt.get("primary_color") or ga.get("primary_color") or "#1a4d8e"
    font = rt.get("font_family") or ga.get("font_family") or "Helvetica"
    logo_url = rt.get("logo_url") or ga.get("logo_url")
    header_text = rt.get("header_text") or "Receipt"
    footer_text = rt.get("footer_text") or ga.get("receipt_footer_text") or "Thank you!"
    show_items = rt.get("show_items") if "show_items" in rt else True
    show_item_description = rt.get("show_item_description") if "show_item_description" in rt else False
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
                "description": li.description,
                "quantity": li.quantity,
                "unit_price": _format_money(Decimal(li.unit_price), currency, region["number_format"], symbol_position),
                "line_total": _format_money(Decimal(li.line_total), currency, region["number_format"], symbol_position),
            }
        )

    template = get_template("core/receipt_print.html")
    html = template.render(
        {
            "receipt": receipt,
            "receipt_number": receipt_number,
            "payment_date_fmt": _format_date_for_pattern(receipt.payment_date, region["date_format"]),
            "amount_paid_fmt": _format_money(Decimal(receipt.amount_paid), currency, region["number_format"], symbol_position),
            "invoice_total_fmt": _format_money(Decimal(invoice.total_amount), currency, region["number_format"], symbol_position),
            "invoice_items": rendered_items,
            "primary": primary,
            "font": font,
            "logo_url": logo_url,
            "header_text": header_text,
            "footer_text": footer_text,
            "show_items": bool(show_items),
            "show_item_description": bool(show_item_description),
            **templates,
        }
    )

    if fmt == "html":
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
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
        )

    try:
        from weasyprint import HTML
    except (ImportError, OSError):
        return RenderedDocument(
            filename=f"receipt_{receipt.id}.html",
            content_type="text/html; charset=utf-8",
            content=html.encode("utf-8"),
        )
    pdf = HTML(string=html).write_pdf()
    return RenderedDocument(
        filename=f"receipt_{receipt.id}.pdf",
        content_type="application/pdf",
        content=cast(bytes, pdf),
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
            subject = f"Invoice {cast(Invoice, delivery.invoice).invoice_number}"
        else:
            doc = render_receipt(request, cast(Receipt, delivery.receipt), cast(DocumentFormat, delivery.format))
            subject = f"Receipt RCPT-{cast(Receipt, delivery.receipt).id}"
        if not token and delivery.download_token_hash:
            token, token_hash, expires_at = create_download_token(ttl_minutes=60)
            delivery.download_token_hash = token_hash
            delivery.download_expires_at = expires_at
            delivery.save(update_fields=["download_token_hash", "download_expires_at", "updated_at"])
        link = None
        if token:
            link = f"{backend_public_base_url()}/api/documents/deliveries/{delivery.id}/download/?token={token}"
        body_text = "Please find your document attached." + (f"\n\nDownload link: {link}\n" if link else "")
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
