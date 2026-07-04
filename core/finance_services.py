from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from rest_framework.exceptions import ValidationError

from .models import Invoice


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
