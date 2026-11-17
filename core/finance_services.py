from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional

from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import InventoryMovement, Invoice, Item, Receipt


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


def invoice_payment_totals(invoice: Invoice) -> tuple[Decimal, Decimal]:
    paid = invoice.receipts.filter(is_deleted=False).aggregate(total=Sum("amount_paid"))["total"] or Decimal("0.00")
    paid = q2(Decimal(str(paid)))
    return paid, outstanding_invoice_amount(invoice.total_amount, paid)


def receipt_payment_progress(receipt: Receipt) -> tuple[Decimal, Decimal]:
    """Return cumulative paid and remaining balance at this receipt's date/sequence."""
    through_receipt = Receipt.objects.filter(
        invoice_id=receipt.invoice_id,
        is_deleted=False,
    ).filter(
        Q(payment_date__lt=receipt.payment_date)
        | Q(payment_date=receipt.payment_date, id__lte=receipt.id)
    )
    paid = through_receipt.aggregate(total=Sum("amount_paid"))["total"] or Decimal("0.00")
    paid = q2(Decimal(str(paid)))
    return paid, outstanding_invoice_amount(receipt.invoice.total_amount, paid)


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


def apply_stock_movement(
    item_id: int,
    delta: int,
    *,
    reason: str,
    invoice: Optional[Invoice] = None,
    user=None,
    note: str = "",
    allow_negative: bool = False,
) -> Optional[InventoryMovement]:
    """Apply one stock change and record it in the inventory ledger.

    The stock update and its ledger row belong to the caller's transaction, so
    ``Item.stock_quantity`` and the ledger can never drift apart. Raises a
    validation error instead of driving stock below zero unless the caller opts
    in (the historical backfill does).
    """
    delta = int(delta)
    if delta == 0:
        return None

    try:
        item = Item.objects.select_for_update().get(pk=item_id)
    except Item.DoesNotExist:
        raise ValidationError(f"Item {item_id} not found")

    before = int(item.stock_quantity or 0)
    after = before + delta
    if after < 0 and not allow_negative:
        raise ValidationError(f"Insufficient stock for item {item_id}")

    Item.objects.filter(pk=item_id).update(stock_quantity=after, updated_at=timezone.now())
    movement = InventoryMovement.objects.create(
        item_id=item_id,
        invoice=invoice,
        reason=reason,
        delta=delta,
        quantity_before=before,
        quantity_after=after,
        note=note or "",
        created_by=user if getattr(user, "is_authenticated", False) else None,
    )
    logger.info(
        "inventory.movement item_id=%s reason=%s delta=%s before=%s after=%s invoice_id=%s",
        item_id,
        reason,
        delta,
        before,
        after,
        getattr(invoice, "id", None),
    )
    return movement


def invoice_deducted_quantities(invoice: Invoice) -> dict[int, int]:
    """Net units taken out of stock for an invoice, per item id.

    Read from the ledger so that a sale plus any later line-item edits nets out
    to exactly the amount the invoice is currently holding.
    """
    net: dict[int, int] = {}
    movements = InventoryMovement.objects.filter(
        invoice_id=invoice.pk,
        reason__in=[InventoryMovement.REASON_SALE, InventoryMovement.REASON_EDIT],
    ).values_list("item_id", "delta")
    for item_id, delta in movements:
        net[item_id] = net.get(item_id, 0) + int(delta)
    return net


def restore_inventory_for_invoice(
    invoice: Invoice,
    *,
    reason: str = InventoryMovement.REASON_VOID,
    user=None,
    note: str = "",
) -> dict[int, int]:
    """Put back every unit an invoice took out of stock and clear its stamp.

    Idempotent: the deduction stamp is cleared in the same transaction, so a
    second call is a no-op. Quantities come from the ledger; invoices deducted
    before the ledger existed fall back to their current line items.
    """
    if invoice.inventory_deducted_at is None:
        return {}

    net_by_item = invoice_deducted_quantities(invoice)
    if not net_by_item:
        for line in invoice.invoice_items.select_related("item").filter(is_deleted=False):
            if line.item.type == "service":
                continue
            quantity = int(line.quantity or 0)
            if quantity:
                net_by_item[line.item_id] = net_by_item.get(line.item_id, 0) - quantity

    restored: dict[int, int] = {}
    for item_id in sorted(net_by_item):
        quantity = -int(net_by_item[item_id])
        if quantity == 0:
            continue
        apply_stock_movement(item_id, quantity, reason=reason, invoice=invoice, user=user, note=note)
        restored[item_id] = quantity

    Invoice.objects.filter(pk=invoice.pk).update(inventory_deducted_at=None)
    invoice.inventory_deducted_at = None
    logger.info("inventory.restore invoice_id=%s restored=%s", invoice.id, restored)
    return restored


def deduct_inventory_for_invoice(invoice: Invoice, *, allow_negative: bool = False, user=None) -> None:
    """Subtract sold quantities from stock once an invoice becomes a completed sale.

    Called from every path that can move an invoice into "Sent"/"Paid" (invoice
    create/update, receipt recording, the invoice pay action, payment-provider
    settlement and the historical backfill). Idempotent: ``Invoice.inventory_deducted_at``
    guards against double deduction on payment retries or status re-syncs, and it
    is only stamped when the deduction succeeds.

    ``allow_negative`` lets the historical backfill command deduct even when
    current stock is short (driving the balance negative) instead of aborting.
    """
    if invoice.inventory_deducted_at is not None:
        return

    required_by_item: dict[int, int] = {}
    for line in invoice.invoice_items.select_related("item").filter(is_deleted=False):
        if line.item.type == "service":
            continue
        required_by_item[line.item_id] = required_by_item.get(line.item_id, 0) + int(line.quantity or 0)

    if required_by_item:
        # Validate every line before touching stock so a short item cannot leave
        # an invoice half deducted.
        items = {
            item.id: item
            for item in Item.objects.select_for_update().filter(id__in=sorted(required_by_item), is_deleted=False)
        }
        for item_id, required_qty in required_by_item.items():
            db_item = items.get(item_id)
            if db_item is None:
                raise ValidationError(f"Insufficient stock for item {item_id}")
            if not allow_negative and int(db_item.stock_quantity or 0) < required_qty:
                raise ValidationError(f"Insufficient stock for item {item_id}")
        for item_id in sorted(required_by_item):
            required_qty = required_by_item[item_id]
            if required_qty <= 0:
                continue
            apply_stock_movement(
                item_id,
                -required_qty,
                reason=InventoryMovement.REASON_SALE,
                invoice=invoice,
                user=user,
                note=f"Invoice {invoice.invoice_number}",
                allow_negative=allow_negative,
            )

    Invoice.objects.filter(pk=invoice.pk, inventory_deducted_at__isnull=True).update(
        inventory_deducted_at=timezone.now()
    )
    invoice.refresh_from_db()
    logger.info("inventory.deduct invoice_id=%s deducted_at=%s", invoice.id, invoice.inventory_deducted_at)
