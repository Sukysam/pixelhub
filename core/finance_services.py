from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Invoice, Item


logger = logging.getLogger(__name__)

CENTS = Decimal("0.01")


def q2(value: Decimal) -> Decimal:
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def format_decimal_display(value: Decimal) -> str:
    value = q2(Decimal(value))
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def resolve_invoice_discount(
    subtotal: Decimal,
    discount_type: Optional[str],
    discount_value: Any,
) -> tuple[str, Decimal, Decimal]:
    subtotal = q2(Decimal(subtotal or 0))
    normalized_type = str(discount_type or Invoice.DISCOUNT_TYPE_PERCENTAGE).strip().lower()
    allowed_types = {choice for choice, _ in Invoice.DISCOUNT_TYPE_CHOICES}
    if normalized_type not in allowed_types:
        raise ValidationError({"discount_type": "Invalid discount_type"})

    if discount_value in (None, ""):
        normalized_value = Decimal("0.00")
    else:
        try:
            normalized_value = q2(Decimal(str(discount_value)))
        except (InvalidOperation, TypeError):
            raise ValidationError({"discount_value": "discount_value must be a valid number"})

    if normalized_value < 0:
        raise ValidationError({"discount_value": "discount_value must be >= 0"})

    if normalized_type == Invoice.DISCOUNT_TYPE_PERCENTAGE:
        if normalized_value > Decimal("100.00"):
            raise ValidationError({"discount_value": "Percentage discount must be between 0 and 100"})
        discount_amount = q2((subtotal * normalized_value) / Decimal("100"))
    else:
        if normalized_value > subtotal:
            raise ValidationError({"discount_value": "Fixed discount cannot exceed the invoice subtotal"})
        discount_amount = normalized_value

    if discount_amount > subtotal:
        raise ValidationError({"discount_value": "Discount cannot exceed the invoice subtotal"})

    return normalized_type, normalized_value, discount_amount


def invoice_discount_context(invoice: Invoice, currency, number_format: str, symbol_position: str, *, format_money) -> dict[str, Any]:
    discount_amount = q2(Decimal(getattr(invoice, "discount_amount", 0) or 0))
    discount_value = q2(Decimal(getattr(invoice, "discount_value", 0) or 0))
    discount_type = str(getattr(invoice, "discount_type", Invoice.DISCOUNT_TYPE_PERCENTAGE) or Invoice.DISCOUNT_TYPE_PERCENTAGE)
    if discount_amount <= 0:
        return {
            "has_discount": False,
            "discount_type_label": "",
            "discount_value_label": "",
            "discount_amount_fmt": "",
            "discount_summary_label": "",
        }

    if discount_type == Invoice.DISCOUNT_TYPE_FIXED:
        discount_type_label = "Fixed amount"
        discount_value_label = format_money(discount_value, currency, number_format, symbol_position)
    else:
        discount_type_label = "Percentage"
        discount_value_label = f"{format_decimal_display(discount_value)}%"

    return {
        "has_discount": True,
        "discount_type_label": discount_type_label,
        "discount_value_label": discount_value_label,
        "discount_amount_fmt": format_money(discount_amount, currency, number_format, symbol_position),
        "discount_summary_label": f"{discount_type_label} ({discount_value_label})",
    }


def outstanding_invoice_amount(invoice_total: Any, payment_total: Any = None) -> Decimal:
    total = q2(Decimal(str(invoice_total or 0)))
    paid = q2(Decimal(str(payment_total or 0)))
    outstanding = q2(total - paid)
    return outstanding if outstanding > Decimal("0.00") else Decimal("0.00")


def sync_invoice_status_with_payments(invoice: Invoice, payment_total: Any) -> str:
    total_paid = q2(Decimal(str(payment_total or 0)))
    invoice_total = q2(Decimal(str(invoice.total_amount or 0)))
    target_status = invoice.status
    if total_paid >= invoice_total:
        target_status = "Paid"
    elif invoice.status == "Paid":
        target_status = "Sent"

    if target_status != invoice.status:
        Invoice.objects.filter(pk=invoice.pk).update(status=target_status)
        invoice.status = target_status
    return target_status


def deduct_inventory_for_invoice(invoice: Invoice, *, allow_negative: bool = False) -> None:
    """Subtract sold quantities from stock once an invoice reaches a completed state.

    Called from every path that can move an invoice into "Sent"/"Paid" (invoice
    create/update/bulk status, receipt recording, the invoice pay action and
    payment-provider settlement). Idempotent: ``Invoice.inventory_deducted_at``
    guards against double deduction on payment retries or status re-syncs, and it
    is only stamped when the deduction succeeds.

    ``allow_negative`` lets the historical backfill command deduct even when
    current stock is short (driving the balance negative) instead of aborting.
    """
    if invoice.inventory_deducted_at is not None:
        return

    invoice_items = list(invoice.invoice_items.select_related("item").filter(is_deleted=False))
    required_by_item: dict[int, int] = {}
    for line in invoice_items:
        if line.item.type == "service":
            continue
        required_by_item[line.item_id] = required_by_item.get(line.item_id, 0) + int(line.quantity or 0)

    if required_by_item:
        items = {
            item.id: item
            for item in Item.objects.select_for_update().filter(id__in=list(required_by_item.keys()), is_deleted=False)
        }
        for item_id, required_qty in required_by_item.items():
            db_item = items.get(item_id)
            if db_item is None:
                raise ValidationError(f"Insufficient stock for item {item_id}")
            if not allow_negative and db_item.stock_quantity < required_qty:
                raise ValidationError(f"Insufficient stock for item {item_id}")
        for item_id, required_qty in required_by_item.items():
            Item.objects.filter(pk=item_id).update(stock_quantity=F("stock_quantity") - required_qty)

    Invoice.objects.filter(pk=invoice.pk, inventory_deducted_at__isnull=True).update(
        inventory_deducted_at=timezone.now()
    )
    invoice.refresh_from_db()
    logger.info("inventory.deduct invoice_id=%s deducted_at=%s", invoice.id, invoice.inventory_deducted_at)
