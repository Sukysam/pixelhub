from decimal import Decimal
from datetime import date
import hashlib
import hmac
import io
import json
import os
import secrets
import tempfile
from unittest.mock import patch

from django.urls import reverse
from django.contrib.auth.models import User, Permission
from django.utils import timezone
from django.core.cache import cache
from django.core import mail
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from rest_framework import status
from rest_framework.test import APITestCase

from PIL import Image
from openpyxl import Workbook, load_workbook

from .models import (
    Item,
    Invoice,
    Customer,
    Receipt,
    InvoiceItem,
    AuditLog,
    Expense,
    Currency,
    ExchangeRate,
    GlobalSettings,
    UserSettings,
    UserProfile,
    SocialAuthConnection,
    EmailVerificationToken,
    AccessToken,
    AdminMfaDevice,
    Role,
    UserRole,
    DocumentDelivery,
    PaymentTransaction,
    BusinessAccount,
    BusinessMembership,
    evaluate_invoice_payment_status,
)
from .views import _rate_limit
from .auth_service import totp_now
from .documents import create_delivery


def _test_secret() -> str:
    return f"Aa1!{secrets.token_urlsafe(12)}"


class _MockJsonResponse:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


GW_SHARED = "test"


class PersistenceTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.cred = _test_secret()
        self.user = User.objects.create_user(username="admin", password=self.cred)
        self.client.force_authenticate(user=self.user)
        perms = Permission.objects.filter(
            codename__in=[
                "change_customer",
                "delete_customer",
                "change_item",
                "delete_item",
                "change_invoice",
                "delete_invoice",
                "change_receipt",
                "delete_receipt",
                "change_invoiceitem",
                "delete_invoiceitem",
            ]
        )
        self.user.user_permissions.add(*perms)

    def test_customers_crud_and_persistence(self):
        create_url = reverse("customer-list")
        res = self.client.post(
            create_url,
            {"name": "Acme", "email": "acme@example.com", "phone": "123", "billing_address": "Addr"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        customer_id = res.data["id"]

        detail_url = reverse("customer-detail", args=[customer_id])
        res = self.client.get(detail_url)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["name"], "Acme")
        updated_at = res.data["updated_at"]

        self.client.force_authenticate(user=self.user)
        res = self.client.patch(detail_url, {"phone": "456", "updated_at": updated_at}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["phone"], "456")
        updated_at = res.data["updated_at"]

        res = self.client.delete(f"{detail_url}?updated_at={updated_at}")
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(AuditLog.objects.filter(action="delete", object_id=str(customer_id)).exists())

    def test_inventory_invoice_and_receipt_flow(self):
        customer = self.client.post(
            reverse("customer-list"),
            {"name": "Buyer", "email": "buyer@example.com"},
            format="json",
        ).data

        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "sku": "W-001", "unit_price": "10.00", "tax_rate": "10.0", "stock_quantity": 5},
            format="json",
        ).data

        invoice_res = self.client.post(
            reverse("invoice-list"),
            {
                "customer": customer["id"],
                "status": "Draft",
                "items": [{"item": item["id"], "quantity": 2}],
            },
            format="json",
        )
        self.assertEqual(invoice_res.status_code, status.HTTP_201_CREATED)
        invoice_id = invoice_res.data["id"]
        self.assertTrue(invoice_res.data["invoice_number"].startswith("INV-"))
        self.assertEqual(Decimal(invoice_res.data["subtotal"]), Decimal("20.00"))
        self.assertEqual(Decimal(invoice_res.data["tax_total"]), Decimal("2.00"))
        self.assertEqual(Decimal(invoice_res.data["total_amount"]), Decimal("22.00"))

        invoice_detail = reverse("invoice-detail", args=[invoice_id])
        self.client.force_authenticate(user=self.user)
        sent_res = self.client.patch(invoice_detail, {"status": "Sent"}, format="json")
        self.assertEqual(sent_res.status_code, status.HTTP_200_OK)

        db_item = Item.objects.get(pk=item["id"])
        self.assertEqual(db_item.stock_quantity, 3)

        self.client.force_authenticate(user=self.user)
        receipt_res = self.client.post(
            reverse("receipt-list"),
            {
                "invoice": invoice_id,
                "amount_paid": "22.00",
                "payment_method": "Cash",
                "reference_number": "R-1",
            },
            format="json",
        )
        self.assertEqual(receipt_res.status_code, status.HTTP_201_CREATED)
        invoice = Invoice.objects.get(pk=invoice_id)
        self.assertEqual(invoice.status, "Paid")

    def test_prevent_negative_stock_deduction(self):
        customer = self.client.post(
            reverse("customer-list"),
            {"name": "Buyer", "email": "buyer@example.com"},
            format="json",
        ).data

        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "sku": "W-002", "unit_price": "10.00", "tax_rate": "0", "stock_quantity": 1},
            format="json",
        ).data

        invoice_res = self.client.post(
            reverse("invoice-list"),
            {
                "customer": customer["id"],
                "status": "Draft",
                "items": [{"item": item["id"], "quantity": 2}],
            },
            format="json",
        )
        self.assertEqual(invoice_res.status_code, status.HTTP_201_CREATED)
        invoice_id = invoice_res.data["id"]

        invoice_detail = reverse("invoice-detail", args=[invoice_id])
        self.client.force_authenticate(user=self.user)
        res = self.client.patch(invoice_detail, {"status": "Sent"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Item.objects.get(pk=item["id"]).stock_quantity, 1)

    def test_dashboard_metrics(self):
        customer = self.client.post(
            reverse("customer-list"),
            {"name": "Buyer", "email": "buyer@example.com"},
            format="json",
        ).data

        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "sku": "W-003", "unit_price": "10.00", "tax_rate": "0", "stock_quantity": 5},
            format="json",
        ).data

        invoice_res = self.client.post(
            reverse("invoice-list"),
            {
                "customer": customer["id"],
                "status": "Sent",
                "items": [{"item": item["id"], "quantity": 2}],
            },
            format="json",
        )
        self.assertEqual(invoice_res.status_code, status.HTTP_201_CREATED)

        dash_res = self.client.get(reverse("dashboard-list"))
        self.assertEqual(dash_res.status_code, status.HTTP_200_OK)
        self.assertEqual(dash_res.data["outstanding_invoices_count"], 1)

        receipt_res = self.client.post(
            reverse("receipt-list"),
            {"invoice": invoice_res.data["id"], "amount_paid": "20.00", "payment_method": "Cash"},
            format="json",
        )
        self.assertEqual(receipt_res.status_code, status.HTTP_201_CREATED)

        dash_res = self.client.get(reverse("dashboard-list"))
        self.assertEqual(dash_res.status_code, status.HTTP_200_OK)
        self.assertEqual(dash_res.data["outstanding_invoices_count"], 0)

    def test_reports_summary(self):
        customer = self.client.post(
            reverse("customer-list"),
            {"name": "Buyer", "email": "buyer@example.com"},
            format="json",
        ).data

        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "sku": "W-004", "unit_price": "10.00", "tax_rate": "0", "stock_quantity": 5},
            format="json",
        ).data

        invoice_res = self.client.post(
            reverse("invoice-list"),
            {
                "customer": customer["id"],
                "status": "Sent",
                "items": [{"item": item["id"], "quantity": 2}],
            },
            format="json",
        )
        self.assertEqual(invoice_res.status_code, status.HTTP_201_CREATED)

        receipt_res = self.client.post(
            reverse("receipt-list"),
            {"invoice": invoice_res.data["id"], "amount_paid": "20.00", "payment_method": "Cash"},
            format="json",
        )
        self.assertEqual(receipt_res.status_code, status.HTTP_201_CREATED)

        res = self.client.get(reverse("reports-list"))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("revenue_total", res.data)
        self.assertIn("invoice_status", res.data)
        self.assertIn("top_items", res.data)

    def test_soft_delete_customer_blocked_when_invoices_exist(self):
        customer = Customer.objects.create(name="C1")
        Invoice.objects.create(invoice_number="INV-2026-9999", customer=customer)
        self.client.force_authenticate(user=self.user)
        res = self.client.delete(reverse("customer-detail", args=[customer.id]))
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        customer.refresh_from_db()
        self.assertFalse(customer.is_deleted)

    def test_customer_delete_allows_access_token_role_user_without_django_model_perms(self):
        user2 = User.objects.create_user(username="u2", password=_test_secret())
        role = Role.objects.get(name="user")
        token_row = AccessToken.objects.create(user=user2, role=role, key="tok_u2_user")
        customer = Customer.objects.create(name="C-TOKEN")

        self.client.force_authenticate(user=None)
        res = self.client.delete(
            reverse("customer-detail", args=[customer.id]),
            HTTP_AUTHORIZATION=f"Token {token_row.key}",
        )
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        customer.refresh_from_db()
        self.assertTrue(customer.is_deleted)

    def test_customer_delete_denies_session_auth_without_model_permission(self):
        limited_role = Role.objects.create(name="limited", description="Limited")
        user2 = User.objects.create_user(username="u3", password=_test_secret())
        UserRole.objects.filter(user=user2).delete()
        UserRole.objects.create(user=user2, role=limited_role)

        customer = Customer.objects.create(name="C-NO-PERM")
        self.client.force_authenticate(user=user2)
        res = self.client.delete(reverse("customer-detail", args=[customer.id]))
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_invoice_soft_delete_cascades_invoice_items_and_receipts_and_audits(self):
        customer = Customer.objects.create(name="C2")
        item = Item.objects.create(name="W", unit_price=Decimal("10.00"), stock_quantity=10)
        inv = Invoice.objects.create(invoice_number="INV-2026-8888", customer=customer, status="Draft")
        InvoiceItem.objects.create(invoice=inv, item=item, quantity=1, unit_price=item.unit_price, line_total=Decimal("10.00"))
        Receipt.objects.create(invoice=inv, amount_paid=Decimal("5.00"), payment_method="Cash")

        self.client.force_authenticate(user=self.user)
        res = self.client.delete(reverse("invoice-detail", args=[inv.id]))
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        inv.refresh_from_db()
        self.assertTrue(inv.is_deleted)
        self.assertEqual(InvoiceItem.objects.filter(invoice=inv, is_deleted=False).count(), 0)
        self.assertEqual(Receipt.objects.filter(invoice=inv, is_deleted=False).count(), 0)
        self.assertTrue(AuditLog.objects.filter(action="delete", object_id=str(inv.id)).exists())

    def test_receipt_update_recomputes_invoice_paid_status(self):
        customer = Customer.objects.create(name="C3")
        item = Item.objects.create(name="W", unit_price=Decimal("10.00"), stock_quantity=10)
        inv = Invoice.objects.create(invoice_number="INV-2026-7777", customer=customer, status="Sent", subtotal=Decimal("10.00"), total_amount=Decimal("10.00"))
        r = Receipt.objects.create(invoice=inv, amount_paid=Decimal("10.00"), payment_method="Cash")
        inv.refresh_from_db()
        self.assertEqual(inv.status, "Sent")

        self.client.force_authenticate(user=self.user)
        update_res = self.client.patch(
            reverse("receipt-detail", args=[r.id]),
            {"amount_paid": "10.00"},
            format="json",
        )
        self.assertEqual(update_res.status_code, status.HTTP_200_OK)
        inv.refresh_from_db()
        self.assertEqual(inv.status, "Paid")

        update_res = self.client.patch(
            reverse("receipt-detail", args=[r.id]),
            {"amount_paid": "1.00"},
            format="json",
        )
        self.assertEqual(update_res.status_code, status.HTTP_200_OK)
        inv.refresh_from_db()
        self.assertEqual(inv.status, "Sent")

    def test_evaluate_invoice_payment_status_paid_when_payments_cover_total(self):
        self.assertEqual(evaluate_invoice_payment_status("10.00", "10.00"), "paid")
        self.assertEqual(evaluate_invoice_payment_status(Decimal("10.00"), Decimal("10.01")), "paid")
        self.assertEqual(evaluate_invoice_payment_status("0.00", None), "paid")

    def test_evaluate_invoice_payment_status_bal_when_outstanding(self):
        self.assertEqual(evaluate_invoice_payment_status("10.00", "9.99"), "bal")
        self.assertEqual(evaluate_invoice_payment_status("10.00", None), "bal")

    def test_evaluate_invoice_payment_status_invalid_inputs(self):
        with self.assertRaises(ValueError):
            evaluate_invoice_payment_status(None, "0.00")
        with self.assertRaises(ValueError):
            evaluate_invoice_payment_status("-1.00", "0.00")
        with self.assertRaises(ValueError):
            evaluate_invoice_payment_status("10.00", "-0.01")
        with self.assertRaises(ValueError):
            evaluate_invoice_payment_status("abc", "0.00")
        with self.assertRaises(ValueError):
            evaluate_invoice_payment_status("10.00", "NaN")

    def test_item_delete_blocked_when_referenced_by_active_invoice(self):
        customer = self.client.post(reverse("customer-list"), {"name": "B"}, format="json").data
        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "sku": "WX", "unit_price": "10.00", "tax_rate": "0", "stock_quantity": 5},
            format="json",
        ).data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data
        self.assertIsNotNone(inv["id"])

        self.client.force_authenticate(user=self.user)
        res = self.client.delete(reverse("item-detail", args=[item["id"]]))
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_bulk_delete_blocks_customers_with_invoices(self):
        c1 = self.client.post(reverse("customer-list"), {"name": "C1"}, format="json").data
        c2 = self.client.post(reverse("customer-list"), {"name": "C2"}, format="json").data
        Invoice.objects.create(invoice_number="INV-2026-1111", customer_id=c1["id"])

        self.client.force_authenticate(user=self.user)
        res = self.client.post(reverse("customer-bulk-delete"), {"ids": [c1["id"], c2["id"]]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("blocked_ids", res.data)

    def test_bulk_delete_receipts_recomputes_invoice_status(self):
        customer = Customer.objects.create(name="C4")
        inv = Invoice.objects.create(
            invoice_number="INV-2026-2222",
            customer=customer,
            status="Paid",
            subtotal=Decimal("10.00"),
            total_amount=Decimal("10.00"),
        )
        r1 = Receipt.objects.create(invoice=inv, amount_paid=Decimal("6.00"), payment_method="Cash")
        r2 = Receipt.objects.create(invoice=inv, amount_paid=Decimal("4.00"), payment_method="Cash")

        self.client.force_authenticate(user=self.user)
        res = self.client.post(reverse("receipt-bulk-delete"), {"ids": [r1.id]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        inv.refresh_from_db()
        self.assertEqual(inv.status, "Sent")

        res = self.client.post(reverse("receipt-bulk-delete"), {"ids": [r2.id]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        inv.refresh_from_db()
        self.assertEqual(inv.status, "Sent")

    def test_concurrency_conflict_returns_409(self):
        cust = self.client.post(reverse("customer-list"), {"name": "C"}, format="json").data
        detail_url = reverse("customer-detail", args=[cust["id"]])
        self.client.force_authenticate(user=self.user)
        res = self.client.patch(detail_url, {"phone": "1", "updated_at": "2000-01-01T00:00:00Z"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_rbac_denies_without_permission(self):
        limited_role = Role.objects.create(name="limited2", description="Limited2")
        user2 = User.objects.create_user(username="u2", password=_test_secret())
        UserRole.objects.filter(user=user2).delete()
        UserRole.objects.create(user=user2, role=limited_role)
        cust = self.client.post(reverse("customer-list"), {"name": "C"}, format="json").data
        detail_url = reverse("customer-detail", args=[cust["id"]])
        self.client.force_authenticate(user=user2)
        res = self.client.patch(detail_url, {"phone": "1"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_item_tax_rate_validation(self):
        res = self.client.post(
            reverse("item-list"),
            {"name": "BadTax", "unit_price": "1.00", "tax_rate": "200", "stock_quantity": 1},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_service_cannot_have_stock(self):
        res = self.client.post(
            reverse("item-list"),
            {"type": "service", "name": "Consulting", "unit_price": "100.00", "stock_quantity": 1},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_adjust_stock_success(self):
        item = self.client.post(
            reverse("item-list"),
            {"name": "Widget", "unit_price": "1.00", "stock_quantity": 1},
            format="json",
        ).data
        self.client.force_authenticate(user=self.user)
        res = self.client.post(reverse("item-adjust-stock", args=[item["id"]]), {"adjustment": 2}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["new_stock_quantity"], 3)

    def test_bulk_delete_items_success(self):
        i1 = self.client.post(reverse("item-list"), {"name": "A", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        i2 = self.client.post(reverse("item-list"), {"name": "B", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        self.client.force_authenticate(user=self.user)
        res = self.client.post(reverse("item-bulk-delete"), {"ids": [i1["id"], i2["id"]]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Item.objects.filter(is_deleted=False).count(), 0)

    def test_bulk_delete_invoices_success(self):
        customer = self.client.post(reverse("customer-list"), {"name": "B"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "W", "unit_price": "1.00", "stock_quantity": 10}, format="json").data
        inv1 = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data
        inv2 = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data
        self.client.force_authenticate(user=self.user)
        res = self.client.post(reverse("invoice-bulk-delete"), {"ids": [inv1["id"], inv2["id"]]}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(Invoice.objects.filter(is_deleted=False).count(), 0)

    def test_receipt_amount_paid_validation(self):
        customer = self.client.post(reverse("customer-list"), {"name": "B"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "W", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data
        res = self.client.post(
            reverse("receipt-list"),
            {"invoice": inv["id"], "amount_paid": "0", "payment_method": "Cash"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invoice_pay_success_and_idempotency(self):
        customer = self.client.post(reverse("customer-list"), {"name": "PayC"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "PayW", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data

        self.client.force_authenticate(user=self.user)
        url = reverse("invoice-pay", args=[inv["id"]])
        res1 = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Cash"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-1",
        )
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        receipt_id = res1.data["id"]

        res2 = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Cash"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-1",
        )
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data["id"], receipt_id)

    def test_invoice_pay_declined_and_gateway_errors(self):
        customer = self.client.post(reverse("customer-list"), {"name": "PayC2"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "PayW2", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data

        self.client.force_authenticate(user=self.user)
        url = reverse("invoice-pay", args=[inv["id"]])
        declined = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "DECLINE"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-2",
        )
        self.assertEqual(declined.status_code, 402)

        unavailable = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "NETWORK"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-3",
        )
        self.assertEqual(unavailable.status_code, 503)

        timeout = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "TIMEOUT"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-4",
        )
        self.assertEqual(timeout.status_code, 504)

    def test_invoice_pay_supports_transaction_date_and_bank_transfer_reference_validation(self):
        customer = self.client.post(reverse("customer-list"), {"name": "PayC4"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "PayW4", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data

        self.client.force_authenticate(user=self.user)
        url = reverse("invoice-pay", args=[inv["id"]])

        missing_ref = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Bank Transfer", "payment_date": "2026-05-01"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-bt-1",
        )
        self.assertEqual(missing_ref.status_code, status.HTTP_400_BAD_REQUEST)

        ok = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Bank Transfer", "reference_number": "TRX-123", "payment_date": "2026-05-01"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-bt-2",
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)
        r = Receipt.objects.get(pk=ok.data["id"])
        self.assertEqual(str(r.payment_date), "2026-05-01")

    def test_invoice_pay_rejects_card_number_in_reference_and_handles_card_edge_cases(self):
        customer = self.client.post(reverse("customer-list"), {"name": "PayC5"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "PayW5", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data

        self.client.force_authenticate(user=self.user)
        url = reverse("invoice-pay", args=[inv["id"]])

        bad_ref = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "4111 1111 1111 1111"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-card-1",
        )
        self.assertEqual(bad_ref.status_code, status.HTTP_400_BAD_REQUEST)

        invalid = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "INVALID"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-card-2",
        )
        self.assertEqual(invalid.status_code, 402)

        expired = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "EXPIRED"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-card-3",
        )
        self.assertEqual(expired.status_code, 402)

        insufficient = self.client.post(
            url,
            {"amount_paid": "1.00", "payment_method": "Card", "reference_number": "INSUFFICIENT"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-card-4",
        )
        self.assertEqual(insufficient.status_code, 402)

    def test_payments_report_api(self):
        customer = Customer.objects.create(name="RC")
        inv = Invoice.objects.create(invoice_number="INV-2026-RPT", customer=customer, status="Sent", subtotal=Decimal("10.00"), total_amount=Decimal("10.00"))
        Receipt.objects.create(invoice=inv, amount_paid=Decimal("3.00"), payment_method="Cash", payment_date=date(2026, 5, 1))
        Receipt.objects.create(invoice=inv, amount_paid=Decimal("7.00"), payment_method="Bank Transfer", reference_number="BT-1", payment_date=date(2026, 5, 2))
        PaymentTransaction.objects.create(invoice=inv, created_by=self.user, provider="paystack", status="pending", amount=Decimal("10.00"), currency_code="NGN", reference="REF-RPT-1")

        self.client.force_authenticate(user=self.user)
        res = self.client.get(reverse("payments-report") + "?start=2026-05-01&end=2026-05-31")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        methods = {r["payment_method"]: r for r in res.data["receipts_by_method"]}
        self.assertIn("Cash", methods)
        self.assertIn("Bank Transfer", methods)

    @override_settings(BANK_TRANSFER_RECONCILIATION_URL="http://bank.example/reconcile", BANK_TRANSFER_RECONCILIATION_SECRET="s")
    @patch("core.views.urllib.request.urlopen")
    def test_bank_transfer_reconciliation_network_failure_is_recorded(self, urlopen_mock):
        from urllib.error import URLError

        urlopen_mock.side_effect = URLError("down")
        customer = Customer.objects.create(name="BC")
        inv = Invoice.objects.create(invoice_number="INV-2026-BANK", customer=customer, status="Sent", subtotal=Decimal("10.00"), total_amount=Decimal("10.00"))

        self.client.force_authenticate(user=self.user)
        res = self.client.post(
            reverse("payment-transaction-list"),
            {"provider": "bank_transfer", "invoice": inv.id, "amount": "10.00", "currency_code": "NGN"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-bank-1",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        tx = PaymentTransaction.objects.get(pk=res.data["id"])
        self.assertEqual(tx.status, "pending")
        self.assertIn("reconciliation_error", tx.metadata or {})

    def test_invoice_pay_overpayment_rejected(self):
        customer = self.client.post(reverse("customer-list"), {"name": "PayC3"}, format="json").data
        item = self.client.post(reverse("item-list"), {"name": "PayW3", "unit_price": "1.00", "stock_quantity": 1}, format="json").data
        inv = self.client.post(
            reverse("invoice-list"),
            {"customer": customer["id"], "status": "Draft", "items": [{"item": item["id"], "quantity": 1}]},
            format="json",
        ).data

        self.client.force_authenticate(user=self.user)
        url = reverse("invoice-pay", args=[inv["id"]])
        res = self.client.post(
            url,
            {"amount_paid": "2.00", "payment_method": "Cash"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-pay-5",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_finance_overview_and_activity_and_top_products(self):
        today = timezone.localdate()
        customer = Customer.objects.create(name="C5")
        item = Item.objects.create(name="Widget", unit_price=Decimal("10.00"), stock_quantity=10)
        inv = Invoice.objects.create(
            invoice_number="INV-2026-3333",
            customer=customer,
            status="Sent",
            issue_date=today,
            subtotal=Decimal("10.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("10.00"),
        )
        InvoiceItem.objects.create(
            invoice=inv,
            item=item,
            quantity=2,
            unit_price=Decimal("10.00"),
            line_subtotal=Decimal("20.00"),
            line_tax=Decimal("0.00"),
            line_total=Decimal("20.00"),
        )
        Receipt.objects.create(invoice=inv, amount_paid=Decimal("10.00"), payment_date=today, payment_method="Cash")
        Expense.objects.create(amount=Decimal("3.00"), expense_date=today, category="Office", description="Paper")

        res = self.client.get(reverse("finance-list") + "?period=1m")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("income_total", res.data)
        self.assertIn("expense_total", res.data)
        self.assertIn("points", res.data)

        activity_all = self.client.get(reverse("finance-activity") + "?type=all&limit=15")
        self.assertEqual(activity_all.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(activity_all.data["events"]), 2)

        activity_income = self.client.get(reverse("finance-activity") + "?type=income&limit=15")
        self.assertEqual(activity_income.status_code, status.HTTP_200_OK)
        self.assertTrue(all(e["type"] == "income" for e in activity_income.data["events"]))

        top = self.client.get(reverse("finance-top-products") + "?period=1m")
        self.assertEqual(top.status_code, status.HTTP_200_OK)
        self.assertIn("products", top.data)
        self.assertGreaterEqual(len(top.data["products"]), 1)


class SettingsTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(username="admin", password=_test_secret(), is_staff=True, is_superuser=True)
        self.staff = User.objects.create_user(username="staff", password=_test_secret(), is_staff=True)
        self.user = User.objects.create_user(username="u1", password=_test_secret())

    def test_country_defaults(self):
        res = self.client.get("/api/settings/country-defaults/?country=DE")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["country"], "DE")
        self.assertEqual(res.data["defaults"]["currency"], "EUR")

        bad = self.client.get("/api/settings/country-defaults/?country=ZZ")
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)

    def test_currency_conversion_direct_and_inverse(self):
        ExchangeRate.objects.create(base_code="USD", quote_code="EUR", rate=Decimal("0.9"))
        res = self.client.get("/api/settings/convert/?amount=10&from=USD&to=EUR")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["converted"], "9.00")

        ExchangeRate.objects.create(base_code="GBP", quote_code="JPY", rate=Decimal("200"))
        inv = self.client.get("/api/settings/convert/?amount=200&from=JPY&to=GBP")
        self.assertEqual(inv.status_code, status.HTTP_200_OK)
        self.assertEqual(inv.data["converted"], "1.00")

    def test_global_settings_admin_only_and_audited(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/settings/global/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.staff)
        staff_get = self.client.get("/api/settings/global/")
        self.assertEqual(staff_get.status_code, status.HTTP_200_OK)
        self.assertIsNone(staff_get.data.get("tax_identification_number"))

        cur = Currency.objects.get(code="USD")
        put_denied = self.client.put(
            "/api/settings/global/",
            {"default_currency": cur.id, "allow_user_overrides": True, "tax_configuration": {"default_rate": "5"}, "appearance": {"company_name": "X"}},
            format="json",
        )
        self.assertEqual(put_denied.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        cur = Currency.objects.get(code="USD")
        put = self.client.put(
            "/api/settings/global/",
            {
                "default_currency": cur.id,
                "allow_user_overrides": True,
                "tax_configuration": {"default_rate": "5"},
                "appearance": {"company_name": "X"},
                "tax_identification_number": "TIN-ADMIN-123",
            },
            format="json",
        )
        self.assertEqual(put.status_code, status.HTTP_200_OK)
        gs = GlobalSettings.objects.get(singleton_key="global")
        self.assertEqual(gs.default_currency_id, cur.id)
        self.assertEqual(gs.tax_identification_number, "TIN-ADMIN-123")
        self.assertTrue(AuditLog.objects.filter(object_id=str(gs.id), action="update").exists())

    def test_effective_settings_hides_tax_id_for_non_admin(self):
        gs = GlobalSettings.objects.get_or_create(singleton_key="global")[0]
        gs.tax_identification_number = "SECRET-TIN"
        gs.save(update_fields=["tax_identification_number"])

        res = self.client.get("/api/settings/effective/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone((res.data.get("global") or {}).get("tax_identification_number"))

        self.client.force_authenticate(user=self.admin)
        res2 = self.client.get("/api/settings/effective/")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual((res2.data.get("global") or {}).get("tax_identification_number"), "SECRET-TIN")

    def test_user_settings_update_and_rollback(self):
        self.client.force_authenticate(user=self.user)
        me = self.client.get("/api/settings/me/")
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        settings_id = me.data["id"]

        patch = self.client.patch("/api/settings/me/", {"date_format": "DD/MM/YYYY"}, format="json")
        self.assertEqual(patch.status_code, status.HTTP_200_OK)
        us = UserSettings.objects.get(pk=settings_id)
        self.assertEqual(us.date_format, "DD/MM/YYYY")

        log = AuditLog.objects.filter(object_id=str(us.id), action="update").order_by("-id").first()
        self.assertIsNotNone(log)
        rollback = self.client.post("/api/settings/rollback/", {"audit_log_id": log.id}, format="json")
        self.assertEqual(rollback.status_code, status.HTTP_200_OK)
        us.refresh_from_db()
        self.assertNotEqual(us.date_format, "DD/MM/YYYY")

    def test_effective_settings_includes_user_when_authenticated(self):
        self.client.force_authenticate(user=self.user)
        res = self.client.get("/api/settings/effective/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(res.data["user"])

    def test_effective_settings_load_many_times(self):
        self.client.force_authenticate(user=self.user)
        for _ in range(50):
            res = self.client.get("/api/settings/effective/")
            self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_effective_settings_uses_global_currency_by_default(self):
        res = self.client.get("/api/settings/effective/", HTTP_X_COUNTRY_CODE="US")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["effective"]["currency_code"], "NGN")


class AdminLogoUploadTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(username="admin_logo", password=_test_secret(), is_staff=True, is_superuser=True)
        self.user = User.objects.create_user(username="u_logo", password=_test_secret())

    def test_non_admin_cannot_upload_logo(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(MEDIA_ROOT=tmp, MEDIA_URL="/media/"):
                img = Image.new("RGB", (10, 10), (200, 10, 10))
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                file = SimpleUploadedFile("logo.png", buf.getvalue(), content_type="image/png")
                self.client.force_authenticate(user=self.user)
                res = self.client.post("/api/admin/logo/upload/", {"file": file}, format="multipart")
                self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_upload_png_logo_creates_thumbnail(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(MEDIA_ROOT=tmp, MEDIA_URL="/media/"):
                img = Image.new("RGB", (400, 120), (200, 10, 10))
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                file = SimpleUploadedFile("logo.png", buf.getvalue(), content_type="image/png")
                self.client.force_authenticate(user=self.admin)
                res = self.client.post("/api/admin/logo/upload/", {"file": file}, format="multipart")
                self.assertEqual(res.status_code, status.HTTP_201_CREATED)
                self.assertTrue(str(res.data.get("logo_url", "")).startswith("/media/uploads/logos/"))
                self.assertTrue(str(res.data.get("thumbnail_url", "")).startswith("/media/uploads/logos/"))

                logo_path = str(res.data["logo_url"]).replace("/media/", "", 1)
                thumb_path = str(res.data["thumbnail_url"]).replace("/media/", "", 1)
                self.assertTrue(os.path.exists(os.path.join(tmp, logo_path)))
                self.assertTrue(os.path.exists(os.path.join(tmp, thumb_path)))

    def test_upload_rejects_unsupported_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(MEDIA_ROOT=tmp, MEDIA_URL="/media/"):
                file = SimpleUploadedFile("logo.gif", b"GIF89a", content_type="image/gif")
                self.client.force_authenticate(user=self.admin)
                res = self.client.post("/api/admin/logo/upload/", {"file": file}, format="multipart")
                self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_upload_rejects_svg_with_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(MEDIA_ROOT=tmp, MEDIA_URL="/media/"):
                svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
                file = SimpleUploadedFile("logo.svg", svg, content_type="image/svg+xml")
                self.client.force_authenticate(user=self.admin)
                res = self.client.post("/api/admin/logo/upload/", {"file": file}, format="multipart")
                self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


class InvoiceFiltersAndSavedViewsTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="u_inv", password=_test_secret())
        self.client.force_authenticate(user=self.user)
        self.c1 = Customer.objects.create(name="Alice", email="a@example.com", created_at=timezone.now())
        self.c2 = Customer.objects.create(name="Bob", email="b@example.com", created_at=timezone.now())

        Invoice.objects.create(
            invoice_number="INV-1",
            customer=self.c1,
            issue_date=date(2026, 5, 1),
            due_date=date(2026, 5, 10),
            subtotal=Decimal("100.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("100.00"),
            status="Draft",
        )
        Invoice.objects.create(
            invoice_number="INV-2",
            customer=self.c1,
            issue_date=date(2026, 5, 2),
            due_date=date(2026, 5, 12),
            subtotal=Decimal("250.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("250.00"),
            status="Paid",
        )
        Invoice.objects.create(
            invoice_number="INV-3",
            customer=self.c2,
            issue_date=date(2026, 4, 15),
            due_date=date(2026, 5, 1),
            subtotal=Decimal("75.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("75.00"),
            status="Sent",
        )

    def test_invoice_filters_status_and_amount_range(self):
        res = self.client.get("/api/invoices/?page=1&status=Paid")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["results"][0]["invoice_number"], "INV-2")

        res2 = self.client.get("/api/invoices/?page=1&total_min=80&total_max=200")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        nums = [r["invoice_number"] for r in res2.data["results"]]
        self.assertIn("INV-1", nums)
        self.assertNotIn("INV-2", nums)
        self.assertNotIn("INV-3", nums)

    def test_invoice_filters_dates_and_customer(self):
        res = self.client.get(f"/api/invoices/?page=1&customer={self.c2.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["results"][0]["invoice_number"], "INV-3")

        res2 = self.client.get("/api/invoices/?page=1&issue_date_from=2026-05-01&issue_date_to=2026-05-31")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        nums = [r["invoice_number"] for r in res2.data["results"]]
        self.assertIn("INV-1", nums)
        self.assertIn("INV-2", nums)
        self.assertNotIn("INV-3", nums)

    def test_invoice_export_csv_uses_filters(self):
        res = self.client.get("/api/invoices/export/?status=Paid")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("text/csv", res.get("Content-Type", ""))
        body = b"".join(res.streaming_content).decode("utf-8")
        self.assertIn("invoice_number", body)
        self.assertIn("INV-2", body)
        self.assertNotIn("INV-1", body)

    def test_invoice_export_xlsx_and_fields(self):
        res = self.client.get("/api/invoices/export/?status=Paid&file_format=xlsx&fields=invoice_number,total_amount")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            res.get("Content-Type", ""),
        )
        wb = load_workbook(io.BytesIO(res.content), read_only=True, data_only=True)
        ws = wb.active
        header = list(next(ws.iter_rows(values_only=True)))
        self.assertEqual(header, ["invoice_number", "total_amount"])
        rows = list(ws.iter_rows(values_only=True))
        flat = [r[0] for r in rows]
        self.assertIn("INV-2", flat)
        self.assertNotIn("INV-1", flat)

    def test_invoice_export_pdf(self):
        res = self.client.get("/api/invoices/export/?status=Paid&file_format=pdf&fields=invoice_number,status")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(
            ("application/pdf" in (res.get("Content-Type") or "")) or ("text/html" in (res.get("Content-Type") or "")),
            msg=f"unexpected content-type: {res.get('Content-Type')}",
        )

    def test_saved_invoice_views_crud(self):
        create = self.client.post("/api/invoices/views/", {"name": "Paid", "filters": {"status": "Paid"}, "is_default": True}, format="json")
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        view_id = create.data["id"]

        ls = self.client.get("/api/invoices/views/")
        self.assertEqual(ls.status_code, status.HTTP_200_OK)
        self.assertEqual(len(ls.data["results"]), 1)
        self.assertEqual(ls.data["results"][0]["name"], "Paid")
        self.assertTrue(ls.data["results"][0]["is_default"])

        patch = self.client.patch(f"/api/invoices/views/{view_id}/", {"name": "Paid invoices"}, format="json")
        self.assertEqual(patch.status_code, status.HTTP_200_OK)

        ls2 = self.client.get("/api/invoices/views/")
        self.assertEqual(ls2.status_code, status.HTTP_200_OK)
        self.assertEqual(ls2.data["results"][0]["name"], "Paid invoices")

        delete = self.client.delete(f"/api/invoices/views/{view_id}/")
        self.assertEqual(delete.status_code, status.HTTP_204_NO_CONTENT)
        ls3 = self.client.get("/api/invoices/views/")
        self.assertEqual(ls3.status_code, status.HTTP_200_OK)
        self.assertEqual(len(ls3.data["results"]), 0)


class ImportExportTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="u_impexp", password=_test_secret())
        perms = Permission.objects.filter(codename__in=["add_item", "change_item", "add_invoice", "change_invoice"])
        self.user.user_permissions.add(*list(perms))
        self.client.force_authenticate(user=self.user)

    def test_inventory_export_csv(self):
        Item.objects.create(type="product", name="Widget", sku="W-1", unit_price=Decimal("10.00"), stock_quantity=5)
        res = self.client.get("/api/items/export/?file_format=csv&fields=sku,name,unit_price,stock_quantity")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        body = b"".join(res.streaming_content).decode("utf-8")
        self.assertIn("sku", body)
        self.assertIn("W-1", body)

    def test_inventory_import_template_downloads(self):
        csv_res = self.client.get("/api/items/import_template/?file_format=csv")
        self.assertEqual(csv_res.status_code, status.HTTP_200_OK)
        self.assertIn("text/csv", csv_res.get("Content-Type", ""))
        self.assertIn("inventory_import_template.csv", csv_res.get("Content-Disposition", ""))
        self.assertIn("unit_price", csv_res.content.decode("utf-8", errors="ignore"))

        xlsx_res = self.client.get("/api/items/import_template/?file_format=xlsx")
        self.assertEqual(xlsx_res.status_code, status.HTTP_200_OK)
        self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx_res.get("Content-Type", ""))
        self.assertIn("inventory_import_template.xlsx", xlsx_res.get("Content-Disposition", ""))

    def test_inventory_import_rollback_and_error_log(self):
        Item.objects.create(type="product", name="Existing", sku="DUP-1", unit_price=Decimal("1.00"), stock_quantity=1)
        csv_body = "type,sku,name,unit_price,tax_rate,stock_quantity\nproduct,DUP-1,New Item,10.00,0,5\nproduct,,Bad Price,xx,0,1\n"
        up = SimpleUploadedFile("items.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/items/import/", {"file": up, "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error_log_token", res.data)
        self.assertFalse(Item.objects.filter(name="New Item", is_deleted=False).exists())
        token = res.data["error_log_token"]
        dl = self.client.get(f"/api/imports/error-log/{token}/")
        self.assertEqual(dl.status_code, status.HTTP_200_OK)
        self.assertIn("text/csv", dl.get("Content-Type", ""))
        self.assertIn("sku already exists", dl.content.decode("utf-8", errors="ignore"))

    def test_inventory_import_success(self):
        csv_body = "type,sku,name,unit_price,tax_rate,stock_quantity\nproduct,SKU-100,Imported,12.50,5,10\n"
        up = SimpleUploadedFile("items.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/items/import/", {"file": up, "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["imported"], 1)
        self.assertTrue(Item.objects.filter(sku="SKU-100", is_deleted=False).exists())

    def test_inventory_import_dry_run(self):
        csv_body = "type,sku,name,unit_price,tax_rate,stock_quantity\nproduct,SKU-DRY,DryRun,1.00,0,1\n"
        up = SimpleUploadedFile("items.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/items/import/", {"file": up, "dry_run": "true", "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("dry_run"))
        self.assertEqual(res.data.get("would_create"), 1)
        self.assertFalse(Item.objects.filter(sku="SKU-DRY", is_deleted=False).exists())

    def test_inventory_import_xlsx_success(self):
        wb = Workbook()
        ws = wb.active
        ws.append(["type", "sku", "name", "unit_price", "tax_rate", "stock_quantity"])
        ws.append(["product", "SKU-XLSX", "FromXLSX", "2.50", "0", 4])
        out = io.BytesIO()
        wb.save(out)
        up = SimpleUploadedFile(
            "items.xlsx",
            out.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        res = self.client.post("/api/items/import/", {"file": up}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(Item.objects.filter(sku="SKU-XLSX", is_deleted=False).exists())

    def test_invoice_import_groups_rows_and_deducts_inventory(self):
        customer = Customer.objects.create(name="Buyer", email="buyer@example.com")
        item = Item.objects.create(type="product", name="Widget", sku="W-001", unit_price=Decimal("10.00"), tax_rate=Decimal("0.00"), stock_quantity=10)
        csv_body = (
            "invoice_key,invoice_number,customer_email,customer_name,status,issue_date,due_date,item_sku,quantity,unit_price,tax_rate,description,unit_of_measure\n"
            "B1,,buyer@example.com,,Sent,2026-05-01,2026-05-10,W-001,2,,,Line 1,pcs\n"
            "B1,,buyer@example.com,,Sent,2026-05-01,2026-05-10,W-001,1,,,Line 2,pcs\n"
        )
        up = SimpleUploadedFile("invoices.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/invoices/import/", {"file": up, "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["imported_invoices"], 1)
        self.assertEqual(res.data["imported_invoice_items"], 2)
        item.refresh_from_db()
        self.assertEqual(item.stock_quantity, 7)
        inv = Invoice.objects.order_by("-id").first()
        self.assertIsNotNone(inv.inventory_deducted_at)
        self.assertEqual(inv.customer_id, customer.id)

    def test_invoice_import_template_downloads(self):
        csv_res = self.client.get("/api/invoices/import_template/?file_format=csv")
        self.assertEqual(csv_res.status_code, status.HTTP_200_OK)
        self.assertIn("text/csv", csv_res.get("Content-Type", ""))
        self.assertIn("invoice_import_template.csv", csv_res.get("Content-Disposition", ""))
        self.assertIn("item_sku", csv_res.content.decode("utf-8", errors="ignore"))

        xlsx_res = self.client.get("/api/invoices/import_template/?file_format=xlsx")
        self.assertEqual(xlsx_res.status_code, status.HTTP_200_OK)
        self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx_res.get("Content-Type", ""))
        self.assertIn("invoice_import_template.xlsx", xlsx_res.get("Content-Disposition", ""))

    def test_invoice_import_dry_run(self):
        customer = Customer.objects.create(name="Buyer2", email="buyer2@example.com")
        Item.objects.create(type="product", name="Widget2", sku="W-002", unit_price=Decimal("10.00"), tax_rate=Decimal("0.00"), stock_quantity=10)
        csv_body = (
            "invoice_key,customer_email,status,issue_date,item_sku,quantity\n"
            "B2,buyer2@example.com,Draft,2026-05-01,W-002,1\n"
        )
        up = SimpleUploadedFile("invoices.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/invoices/import/", {"file": up, "dry_run": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("dry_run"))
        self.assertEqual(res.data.get("would_create_invoices"), 1)
        self.assertEqual(res.data.get("would_create_invoice_items"), 1)
        self.assertFalse(Invoice.objects.filter(customer=customer, is_deleted=False).exists())

    def test_invoice_import_duplicate_invoice_number_rejected(self):
        customer = Customer.objects.create(name="Buyer3", email="buyer3@example.com")
        Item.objects.create(type="product", name="Widget3", sku="W-003", unit_price=Decimal("10.00"), tax_rate=Decimal("0.00"), stock_quantity=10)
        Invoice.objects.create(invoice_number="INV-DUP", customer=customer, status="Draft")
        csv_body = (
            "invoice_number,customer_email,status,issue_date,item_sku,quantity\n"
            "INV-DUP,buyer3@example.com,Draft,2026-05-01,W-003,1\n"
        )
        up = SimpleUploadedFile("invoices.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/invoices/import/", {"file": up, "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error_log_token", res.data)

    def test_invoice_import_missing_item_rejected(self):
        Customer.objects.create(name="Buyer4", email="buyer4@example.com")
        csv_body = (
            "invoice_key,customer_email,status,issue_date,item_sku,quantity\n"
            "B4,buyer4@example.com,Draft,2026-05-01,NO-SUCH-SKU,1\n"
        )
        up = SimpleUploadedFile("invoices.csv", csv_body.encode("utf-8"), content_type="text/csv")
        res = self.client.post("/api/invoices/import/", {"file": up, "rollback_on_error": "true"}, format="multipart")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error_log_token", res.data)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RegistrationTests(APITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def test_register_and_verify_email_flow(self):
        secret = _test_secret()

        with override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", DEFAULT_FROM_EMAIL="no-reply@test.local"):
            res = self.client.post(
                "/api/auth/register/",
                {
                    "email": "new@example.com",
                    "password": secret,
                    "password_confirm": secret,
                    "company_name": "NewCo Ltd",
                    "country_code": "+234",
                    "phone_number": "8012345678",
                    "country": "Nigeria",
                    "accept_terms": True,
                    "website": "",
                },
                format="json",
            )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.data.get("verification_sent", False))
        u = User.objects.get(username="new@example.com")
        self.assertFalse(u.is_active)
        self.assertTrue(u.password.startswith("bcrypt_sha256$"))
        profile = UserProfile.objects.get(user=u)
        self.assertIsNotNone(profile.terms_accepted_at)
        self.assertEqual(profile.company_legal_name, "NewCo Ltd")
        self.assertEqual(profile.phone, "+2348012345678")
        self.assertIsNone(profile.email_verified_at)
        self.assertGreaterEqual(len(mail.outbox), 1)
        self.assertIn("verify-email?token=", (mail.outbox[-1].body or "").lower())

        token_row = EmailVerificationToken.objects.get(user=u)
        verify = self.client.post("/api/auth/verify-email/", {"token": token_row.token}, format="json")
        self.assertEqual(verify.status_code, status.HTTP_200_OK)
        u.refresh_from_db()
        self.assertTrue(u.is_active)
        profile.refresh_from_db()
        self.assertIsNotNone(profile.email_verified_at)

    def test_resend_verification_sends_email(self):
        email = "resend@example.com"
        u = User.objects.create_user(username=email, email=email, password=_test_secret())
        u.is_active = False
        u.save(update_fields=["is_active"])

        mail.outbox.clear()
        res = self.client.post("/api/auth/resend-verification/", {"email": email}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("sent", False))
        self.assertGreaterEqual(len(mail.outbox), 1)

    def test_register_requires_terms(self):
        secret = _test_secret()
        res = self.client.post(
            "/api/auth/register/",
            {
                "email": "t@example.com",
                "password": secret,
                "password_confirm": secret,
                "company_name": "TermsCo Ltd",
                "country_code": "+234",
                "phone_number": "8011111111",
                "country": "Nigeria",
                "accept_terms": False,
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_password_strength(self):
        weak_cred = "weak"
        res = self.client.post(
            "/api/auth/register/",
            {
                "email": "weak@example.com",
                "password": weak_cred,
                "password_confirm": weak_cred,
                "company_name": "WeakCo Ltd",
                "country_code": "+234",
                "phone_number": "8022222222",
                "country": "Nigeria",
                "accept_terms": True,
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_honeypot_submission(self):
        secret = _test_secret()
        res = self.client.post(
            "/api/auth/register/",
            {
                "email": "c@example.com",
                "password": secret,
                "password_confirm": secret,
                "company_name": "BotCo Ltd",
                "country_code": "+234",
                "phone_number": "8033333333",
                "country": "Nigeria",
                "accept_terms": True,
                "website": "https://spam.example.com",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", DEFAULT_FROM_EMAIL="no-reply@test.local")
class PasswordResetTests(APITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        mail.outbox.clear()

    def test_password_reset_request_sends_email_for_existing_user(self):
        User.objects.create_user(username="u1", email="u1@example.com", password=_test_secret())
        res = self.client.post("/api/auth/password-reset/", {"email": "u1@example.com"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("sent", False))
        self.assertGreaterEqual(len(mail.outbox), 1)
        body = mail.outbox[-1].body or ""
        self.assertIn("/reset-password?uid=", body)
        self.assertIn("&token=", body)

    def test_password_reset_confirm_sets_password_and_returns_token(self):
        old_secret = _test_secret()
        new_secret = _test_secret()
        u = User.objects.create_user(username="u2", email="u2@example.com", password=old_secret, is_active=False)
        role = Role.objects.get(name="user")
        existing = AccessToken.objects.create(user=u, role=role, key="existing_token_1")
        uid = urlsafe_base64_encode(force_bytes(u.pk))
        token = PasswordResetTokenGenerator().make_token(u)
        res = self.client.post(
            "/api/auth/password-reset-confirm/",
            {"uid": uid, "token": token, "new_password": new_secret, "new_password_confirm": new_secret},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("reset", False))
        self.assertTrue(res.data.get("token"))
        u.refresh_from_db()
        self.assertTrue(u.check_password(new_secret))
        self.assertTrue(u.is_active)
        existing.refresh_from_db()
        self.assertIsNotNone(existing.revoked_at)
        self.assertTrue(AccessToken.objects.filter(user=u, revoked_at__isnull=True, role__name="user").exists())


class LogoutTests(APITestCase):
    def test_logout_deletes_token(self):
        u = User.objects.create_user(username="u3", password=_test_secret(), email="u3@example.com")
        role = Role.objects.get(name="user")
        token = AccessToken.objects.create(user=u, role=role, key="logout_token_1")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        res = self.client.post("/api/auth/logout/", {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        token.refresh_from_db()
        self.assertIsNotNone(token.revoked_at)


class OAuthRedirectTests(APITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def test_google_start_not_configured_redirects_to_frontend_callback(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", GOOGLE_OAUTH_CLIENT_ID="", GOOGLE_OAUTH_CLIENT_SECRET=""):
            res = self.client.get("/api/auth/google/start/")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res["Location"].startswith("http://frontend.test/auth/callback#"))
        self.assertIn("provider=google", res["Location"])
        self.assertIn("error=not_configured", res["Location"])

    def test_google_start_missing_secret_redirects_to_frontend_callback(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", GOOGLE_OAUTH_CLIENT_ID="cid123", GOOGLE_OAUTH_CLIENT_SECRET=""):
            res = self.client.get("/api/auth/google/start/")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res["Location"].startswith("http://frontend.test/auth/callback#"))
        self.assertIn("provider=google", res["Location"])
        self.assertIn("error=not_configured", res["Location"])

    def test_google_start_configured_redirects_to_google(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", GOOGLE_OAUTH_CLIENT_ID="cid123", GOOGLE_OAUTH_CLIENT_SECRET="sec123"):
            res = self.client.get("/api/auth/google/start/")
        self.assertEqual(res.status_code, 302)
        loc = res["Location"]
        self.assertTrue(loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        self.assertIn("client_id=cid123", loc)
        self.assertIn("redirect_uri=http%3A%2F%2Ftestserver%2Fapi%2Fauth%2Fgoogle%2Fcallback%2F", loc)
        self.assertIn("response_type=code", loc)
        self.assertIn("scope=openid+email+profile", loc)

    def test_google_callback_cancelled_redirects_to_frontend(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", GOOGLE_OAUTH_CLIENT_ID="x", GOOGLE_OAUTH_CLIENT_SECRET="y"):
            state = "state123"
            cache.set(f"google_oauth_state:{state}", {"ip": "127.0.0.1"}, timeout=600)
            res = self.client.get(f"/api/auth/google/callback/?error=access_denied&state={state}")
        self.assertEqual(res.status_code, 302)
        self.assertIn("provider=google", res["Location"])
        self.assertIn("error=cancelled", res["Location"])

    def test_facebook_start_not_configured_redirects_to_frontend_callback(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", FACEBOOK_OAUTH_CLIENT_ID="", FACEBOOK_OAUTH_CLIENT_SECRET=""):
            res = self.client.get("/api/auth/facebook/start/")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res["Location"].startswith("http://frontend.test/auth/callback#"))
        self.assertIn("provider=facebook", res["Location"])
        self.assertIn("error=not_configured", res["Location"])

    def test_facebook_callback_cancelled_redirects_to_frontend(self):
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", FACEBOOK_OAUTH_CLIENT_ID="x", FACEBOOK_OAUTH_CLIENT_SECRET="y"):
            state = "statefb"
            cache.set(f"facebook_oauth_state:{state}", {"ip": "127.0.0.1"}, timeout=600)
            res = self.client.get(f"/api/auth/facebook/callback/?error=access_denied&state={state}")
        self.assertEqual(res.status_code, 302)
        self.assertIn("provider=facebook", res["Location"])
        self.assertIn("error=cancelled", res["Location"])


class ApiCoverageTests(APITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.admin = User.objects.create_user(username="admin2", password=_test_secret(), is_staff=True, is_superuser=True, email="admin2@example.com")
        self.staff = User.objects.create_user(username="staff2", password=_test_secret(), is_staff=True, email="staff2@example.com")
        self.user = User.objects.create_user(username="u_cov", password=_test_secret(), email="u_cov@example.com")

    def test_geo_and_audit_and_admin_users(self):
        geo = self.client.get("/api/settings/geo/", HTTP_ACCEPT_LANGUAGE="de")
        self.assertEqual(geo.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.staff)
        audit = self.client.get("/api/settings/audit/?scope=all&limit=5")
        self.assertEqual(audit.status_code, status.HTTP_200_OK)

        users_denied = self.client.get("/api/admin/users/?page=1")
        self.assertEqual(users_denied.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        users = self.client.get("/api/admin/users/?page=1")
        self.assertEqual(users.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(user=self.user)
        denied = self.client.get("/api/admin/users/?page=1")
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        created_secret = _test_secret()
        created = self.client.post(
            "/api/admin/users/",
            {
                "username": "created_user",
                "password": created_secret,
                "email": "created_user@example.com",
                "company_name": "Created User Co",
                "phone": "8044444444",
                "primary_role": "user",
                "custom_roles": [],
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertTrue(AuditLog.objects.filter(action="create", object_id=str(created.data["id"])).exists())
        patched = self.client.patch("/api/admin/users/", {"id": created.data["id"], "primary_role": "staff"}, format="json")
        self.assertEqual(patched.status_code, status.HTTP_200_OK)
        self.assertTrue(AuditLog.objects.filter(action="update", object_id=str(created.data["id"])).exists())

    def test_currency_and_exchange_rate_crud(self):
        self.client.force_authenticate(user=self.staff)
        list_res = self.client.get("/api/currencies/")
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        codes = [row.get("code") for row in list_res.data]
        self.assertIn("NGN", codes)
        ngn = next((row for row in list_res.data if row.get("code") == "NGN"), None)
        self.assertIsNotNone(ngn)
        self.assertEqual(ngn.get("name"), "Nigerian Naira")
        self.assertEqual(ngn.get("symbol"), "₦")
        self.assertEqual(int(ngn.get("decimal_places")), 2)

        self.client.force_authenticate(user=self.admin)
        created = self.client.post("/api/currencies/", {"code": "KES", "name": "Kenyan Shilling", "symbol": "KSh", "decimal_places": 2}, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        fx = self.client.post("/api/exchange-rates/", {"base_code": "USD", "quote_code": "KES", "rate": "129.50000000"}, format="json")
        self.assertEqual(fx.status_code, status.HTTP_201_CREATED)
        fx_id = fx.data["id"]

        fx_up = self.client.patch(f"/api/exchange-rates/{fx_id}/", {"rate": "130.00000000"}, format="json")
        self.assertEqual(fx_up.status_code, status.HTTP_200_OK)

        fx_del = self.client.delete(f"/api/exchange-rates/{fx_id}/")
        self.assertEqual(fx_del.status_code, status.HTTP_204_NO_CONTENT)

    def test_invoice_pdf_and_receipt_print(self):
        self.client.force_authenticate(user=self.user)
        customer = Customer.objects.create(name="PDF Buyer", email="p@example.com")
        item = Item.objects.create(name="Widget", unit_price=Decimal("10.00"), stock_quantity=10)
        inv = Invoice.objects.create(
            invoice_number="INV-2026-4444",
            customer=customer,
            status="Draft",
            issue_date=timezone.localdate(),
            subtotal=Decimal("10.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("10.00"),
        )
        InvoiceItem.objects.create(
            invoice=inv,
            item=item,
            quantity=1,
            unit_price=Decimal("10.00"),
            line_subtotal=Decimal("10.00"),
            line_tax=Decimal("0.00"),
            line_total=Decimal("10.00"),
        )

        pdf = self.client.get(f"/api/invoices/{inv.id}/download_pdf/")
        self.assertEqual(pdf.status_code, status.HTTP_200_OK)
        self.assertIn("X-PDF-Backend", pdf)
        self.assertTrue(
            ("application/pdf" in (pdf.get("Content-Type") or "")) or ("text/html" in (pdf.get("Content-Type") or "")),
            msg=f"unexpected content-type: {pdf.get('Content-Type')}",
        )

        receipt = Receipt.objects.create(invoice=inv, amount_paid=Decimal("10.00"), payment_method="Cash", reference_number="R1")
        html = self.client.get(f"/api/receipts/{receipt.id}/print_html/")
        self.assertEqual(html.status_code, status.HTTP_200_OK)
        self.assertIn("text/html", html["Content-Type"])

    def test_invoice_pdf_falls_back_to_html_when_weasyprint_render_fails(self):
        self.client.force_authenticate(user=self.user)
        customer = Customer.objects.create(name="PDF Buyer2", email="p2@example.com")
        item = Item.objects.create(name="Widget2", unit_price=Decimal("10.00"), stock_quantity=10)
        inv = Invoice.objects.create(
            invoice_number="INV-2026-4445",
            customer=customer,
            status="Draft",
            issue_date=timezone.localdate(),
            subtotal=Decimal("10.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("10.00"),
        )
        InvoiceItem.objects.create(
            invoice=inv,
            item=item,
            quantity=1,
            unit_price=Decimal("10.00"),
            line_subtotal=Decimal("10.00"),
            line_tax=Decimal("0.00"),
            line_total=Decimal("10.00"),
        )

        try:
            import weasyprint as _weasyprint
        except Exception:
            res = self.client.get(f"/api/invoices/{inv.id}/download_pdf/")
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertIn("text/html", res.get("Content-Type", ""))
            self.assertEqual(res.get("X-PDF-Backend"), "unavailable")
            return

        with patch("weasyprint.HTML.write_pdf", side_effect=OSError("boom")):
            res = self.client.get(f"/api/invoices/{inv.id}/download_pdf/")
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertIn("text/html", res.get("Content-Type", ""))
            self.assertEqual(res.get("X-PDF-Backend"), "failed")


class AuthApiTests(APITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def test_rate_limit_counts_over_window(self):
        cache.clear()
        key = "test:ratelimit"
        self.assertFalse(_rate_limit(key, limit=2, window_seconds=60))
        self.assertFalse(_rate_limit(key, limit=2, window_seconds=60))
        self.assertTrue(_rate_limit(key, limit=2, window_seconds=60))

    def test_login_requires_username_and_password(self):
        res = self.client.post("/api/auth/token/", {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", res.data)

    def test_login_invalid_credentials_returns_detail(self):
        secret = _test_secret()
        wrong_cred = "wrong"
        User.objects.create_user(username="u1", password=secret, is_active=True)
        res = self.client.post("/api/auth/token/", {"username": "u1", "password": wrong_cred}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(str(res.data.get("detail")), "Unable to log in with provided credentials.")

    def test_login_inactive_user_returns_403(self):
        secret = _test_secret()
        User.objects.create_user(username="u2", password=secret, is_active=False)
        res = self.client.post("/api/auth/token/", {"username": "u2", "password": secret}, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("verify your email", str(res.data.get("detail", "")).lower())

    def test_login_success_returns_token(self):
        secret = _test_secret()
        user = User.objects.create_user(username="u3", password=secret, is_active=True)
        res = self.client.post("/api/auth/token/", {"username": "u3", "password": secret}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("token", res.data)
        self.assertEqual(res.data.get("role"), "user")
        self.assertTrue(AccessToken.objects.filter(user=user, role__name="user").exists())

    def test_staff_login_requires_staff_role(self):
        plain_secret = _test_secret()
        staff_secret = _test_secret()
        User.objects.create_user(username="plain", password=plain_secret, is_active=True)
        staff = User.objects.create_user(username="staff_user", password=staff_secret, is_active=True, is_staff=True)

        denied = self.client.post("/api/auth/staff/token/", {"username": "plain", "password": plain_secret}, format="json")
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        ok = self.client.post("/api/auth/staff/token/", {"username": "staff_user", "password": staff_secret}, format="json")
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertEqual(ok.data.get("role"), "staff")
        self.assertTrue(AccessToken.objects.filter(user=staff, role__name="staff").exists())

    def test_admin_login_requires_mfa(self):
        login_secret = _test_secret()
        admin = User.objects.create_user(username="admin_user", password=login_secret, is_active=True, is_staff=True, is_superuser=True)

        denied = self.client.post("/api/auth/admin/token/", {"username": "admin_user", "password": login_secret, "code": "123456"}, format="json")
        self.assertEqual(denied.status_code, status.HTTP_400_BAD_REQUEST)

        setup = self.client.post("/api/auth/admin/mfa/setup/", {"username": "admin_user", "password": login_secret}, format="json")
        self.assertEqual(setup.status_code, status.HTTP_200_OK)
        mfa_secret = setup.data.get("secret")
        self.assertTrue(mfa_secret)

        code = totp_now(mfa_secret)
        confirm = self.client.post("/api/auth/admin/mfa/confirm/", {"username": "admin_user", "password": login_secret, "code": code}, format="json")
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)
        self.assertEqual(confirm.data.get("role"), "admin")
        self.assertTrue(AccessToken.objects.filter(user=admin, role__name="admin").exists())

    def test_me_includes_company_name(self):
        user = User.objects.create_user(username="u_me", password=_test_secret(), is_active=True)
        UserProfile.objects.create(user=user, company_legal_name="Acme Incorporated")
        self.client.force_authenticate(user=user)
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data.get("company_name"), "Acme Incorporated")
        self.assertIn("roles", res.data)

    def test_me_includes_linked_social_accounts(self):
        user = User.objects.create_user(username="u_social", password=_test_secret(), is_active=True, email="u_social@example.com")
        SocialAuthConnection.objects.create(
            user=user,
            provider="google",
            provider_user_id="google-sub-1",
            email="u_social@example.com",
            display_name="U Social",
        )
        self.client.force_authenticate(user=user)
        res = self.client.get("/api/auth/me/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        accounts = res.data.get("social_accounts") or []
        self.assertEqual(len(accounts), 1)
        self.assertEqual(accounts[0]["provider"], "google")

    def test_social_connections_endpoint_returns_provider_status(self):
        user = User.objects.create_user(username="u_links", password=_test_secret(), is_active=True, email="u_links@example.com")
        SocialAuthConnection.objects.create(
            user=user,
            provider="facebook",
            provider_user_id="fb-1",
            email="u_links@example.com",
            display_name="FB User",
        )
        self.client.force_authenticate(user=user)
        res = self.client.get("/api/auth/social/connections/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        rows = {row["provider"]: row for row in res.data["results"]}
        self.assertTrue(rows["facebook"]["connected"])
        self.assertFalse(rows["google"]["connected"])

    def test_google_callback_links_social_account_to_existing_profile(self):
        user = User.objects.create_user(
            username="u_link_google",
            password=_test_secret(),
            is_active=True,
            email="u_link_google@example.com",
        )
        profile = UserProfile.objects.create(user=user)

        with override_settings(
            FRONTEND_BASE_URL="http://frontend.test",
            GOOGLE_OAUTH_CLIENT_ID="cid123",
            GOOGLE_OAUTH_CLIENT_SECRET="sec123",
        ):
            cache.set(
                "google_oauth_state:state-google-link-1",
                {"ip": "127.0.0.1", "intent": "link", "user_id": user.id, "remember": True},
                timeout=600,
            )
            with patch(
                "urllib.request.urlopen",
                side_effect=[
                    _MockJsonResponse({"id_token": "id-token-link-1"}),
                    _MockJsonResponse(
                        {
                            "sub": "google-sub-link-1",
                            "email": user.email,
                            "email_verified": "true",
                            "aud": "cid123",
                            "name": "Linked Google User",
                            "picture": "https://example.com/avatar.png",
                        }
                    ),
                ],
            ):
                res = self.client.get("/api/auth/google/callback/?code=abc&state=state-google-link-1")

        self.assertEqual(res.status_code, 302)
        self.assertIn("provider=google", res["Location"])
        self.assertIn("linked=1", res["Location"])

        connection = SocialAuthConnection.objects.get(provider="google", provider_user_id="google-sub-link-1")
        self.assertEqual(connection.user_id, user.id)
        self.assertEqual(connection.email, user.email)
        self.assertEqual(connection.display_name, "Linked Google User")
        self.assertIsNotNone(UserProfile.objects.get(pk=profile.pk).email_verified_at)
        self.assertTrue(
            AuditLog.objects.filter(
                action="update",
                object_id=str(connection.id),
                changes__event="social_account_linked",
            ).exists()
        )

    def test_register_and_duplicate_email(self):
        secret = _test_secret()
        ok = self.client.post(
            "/api/auth/register/",
            {
                "email": "new@example.com",
                "password": secret,
                "password_confirm": secret,
                "company_name": "NewCo Ltd",
                "country_code": "+234",
                "phone_number": "8055555555",
                "country": "Nigeria",
                "accept_terms": True,
                "website": "",
            },
            format="json",
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ok.data.get("registered"), True)

        dup = self.client.post(
            "/api/auth/register/",
            {
                "email": "new@example.com",
                "password": secret,
                "password_confirm": secret,
                "company_name": "NewCo Ltd",
                "country_code": "+234",
                "phone_number": "8066666666",
                "country": "Nigeria",
                "accept_terms": True,
                "website": "",
            },
            format="json",
        )
        self.assertEqual(dup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", dup.data)

    def test_google_callback_blocks_privileged_account_from_social_sign_in(self):
        privileged = User.objects.create_user(
            username="admin_social",
            email="admin-social@example.com",
            password=_test_secret(),
            is_active=True,
            is_staff=True,
            is_superuser=True,
        )
        with override_settings(FRONTEND_BASE_URL="http://frontend.test", GOOGLE_OAUTH_CLIENT_ID="cid123", GOOGLE_OAUTH_CLIENT_SECRET="sec123"):
            cache.set(
                "google_oauth_state:state-google-1",
                {"ip": "127.0.0.1", "intent": "login", "remember": True},
                timeout=600,
            )
            with patch(
                "urllib.request.urlopen",
                side_effect=[
                    _MockJsonResponse({"id_token": "id-token-1"}),
                    _MockJsonResponse(
                        {
                            "sub": "google-sub-1",
                            "email": privileged.email,
                            "email_verified": "true",
                            "aud": "cid123",
                            "name": "Admin Social",
                        }
                    ),
                ],
            ):
                res = self.client.get("/api/auth/google/callback/?code=abc&state=state-google-1")
        self.assertEqual(res.status_code, 302)
        self.assertIn("error=privileged_account", res["Location"])
        self.assertFalse(SocialAuthConnection.objects.filter(provider="google", provider_user_id="google-sub-1").exists())


class DocumentDeliveryAndPaymentsTests(APITestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(username="u_docs", password=_test_secret(), email="u_docs@example.com", is_active=True)
        self.client.force_authenticate(user=self.user)
        self.customer = Customer.objects.create(name="Buyer", email="buyer@example.com", phone="+2348012345678")
        self.item = Item.objects.create(name="Widget", unit_price=Decimal("10.00"), stock_quantity=10)
        self.invoice = Invoice.objects.create(
            invoice_number="INV-2026-DOCPAY",
            customer=self.customer,
            status="Sent",
            subtotal=Decimal("10.00"),
            tax_total=Decimal("0.00"),
            total_amount=Decimal("10.00"),
        )
        InvoiceItem.objects.create(
            invoice=self.invoice,
            item=self.item,
            quantity=1,
            unit_price=Decimal("10.00"),
            line_subtotal=Decimal("10.00"),
            line_tax=Decimal("0.00"),
            line_total=Decimal("10.00"),
        )

    def test_delivery_download_with_token_allows_anonymous_access(self):
        delivery, token = create_delivery(
            user=self.user,
            document_type="invoice",
            document_id=self.invoice.id,
            channel="share",
            fmt="text",
            ttl_minutes=60,
        )
        self.client.force_authenticate(user=None)
        res = self.client.get(f"/api/documents/deliveries/{delivery.id}/download/?token={token}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res["Content-Type"].startswith("text/plain"))
        self.assertIn("INVOICE", (res.content or b"").decode("utf-8", errors="replace"))

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_delivery_send_returns_success_report_for_email(self):
        res = self.client.post(
            "/api/documents/deliveries/",
            {
                "document_type": "invoice",
                "document_id": self.invoice.id,
                "channel": "email",
                "format": "pdf",
                "to_email": "buyer@example.com",
                "send_now": True,
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn("delivery", res.data)
        self.assertIn("report", res.data)
        self.assertTrue(res.data["report"]["ok"])
        self.assertEqual(res.data["report"]["status"], "sent")
        self.assertEqual(res.data["report"]["channel"], "email")
        self.assertEqual(res.data["report"]["recipient"]["email"], "buyer@example.com")
        self.assertIsNotNone(res.data["report"]["last_attempt_at"])
        self.assertEqual(len(mail.outbox), 1)
        delivery_id = res.data["report"]["delivery_id"]
        self.assertTrue(AuditLog.objects.filter(object_id=str(delivery_id), action="create").exists())

    def test_invoice_share_link_returns_download_url_and_token_works(self):
        res = self.client.post(f"/api/invoices/{self.invoice.id}/share_link/", {"ttl_minutes": 60}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("download_url", res.data)
        download_url = str(res.data["download_url"])
        self.assertIn("/api/documents/deliveries/", download_url)
        self.assertIn("/download/?token=", download_url)

        from urllib.parse import urlsplit, parse_qs

        parts = urlsplit(download_url)
        token = (parse_qs(parts.query).get("token") or [""])[0]
        self.assertTrue(token)
        delivery_id = int(parts.path.strip("/").split("/")[-2])

        self.client.force_authenticate(user=None)
        dl = self.client.get(f"/api/documents/deliveries/{delivery_id}/download/?token={token}")
        self.assertEqual(dl.status_code, status.HTTP_200_OK)

    def test_receipt_share_link_returns_download_url(self):
        r = self.client.post(
            "/api/receipts/",
            {"invoice": self.invoice.id, "amount_paid": "5.00", "payment_method": "Cash", "payment_date": str(timezone.localdate())},
            format="json",
        )
        self.assertEqual(r.status_code, status.HTTP_201_CREATED)
        receipt_id = int(r.data["id"])
        res = self.client.post(f"/api/receipts/{receipt_id}/share_link/", {"ttl_minutes": 60}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn("download_url", res.data)

    @override_settings(PAYSTACK_SECRET_KEY=GW_SHARED)
    def test_paystack_webhook_marks_transaction_succeeded_and_creates_receipt(self):
        tx = PaymentTransaction.objects.create(
            invoice=self.invoice,
            created_by=self.user,
            provider="paystack",
            status="pending",
            amount=Decimal("10.00"),
            currency_code="NGN",
            reference="REFPAYSTACK123",
        )
        payload = {"event": "charge.success", "data": {"id": 991, "reference": tx.reference, "status": "success", "paid_at": timezone.now().isoformat()}}
        raw = json.dumps(payload).encode("utf-8")
        sig = hmac.new(GW_SHARED.encode("utf-8"), raw, hashlib.sha512).hexdigest()
        res = self.client.post("/api/payments/webhooks/paystack/", data=raw, content_type="application/json", HTTP_X_PAYSTACK_SIGNATURE=sig)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        tx.refresh_from_db()
        self.assertEqual(tx.status, "succeeded")
        self.assertTrue(Receipt.objects.filter(invoice=self.invoice, is_deleted=False).exists())
