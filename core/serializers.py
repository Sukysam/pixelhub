import re
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from django.db.models import Sum
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from .expense_security import decrypt_expense_text
from .models import (
    Customer,
    Item,
    Invoice,
    InvoiceItem,
    Receipt,
    Expense,
    SourceAccount,
    Currency,
    ExchangeRate,
    GlobalSettings,
    UserSettings,
    AuditLog,
    DocumentDelivery,
    SavedDocument,
    PaymentTransaction,
    BusinessAccount,
    BusinessMembership,
)
from .rbac import user_has_permission

BUSINESS_INDUSTRY_CHOICES = [
    "Agriculture",
    "Entertainment",
    "Automotive",
    "Construction",
    "Consumer Goods",
    "Education",
    "Energy",
    "Engineering",
    "Environmental Services",
    "Fashion & Apparel",
    "Finance",
    "Food & Beverage",
    "Government",
    "Healthcare",
    "Hospitality",
    "Information Technology",
    "Insurance",
    "Legal Services",
    "Transportation",
    "Logistics",
    "Manufacturing",
    "Media & Publishing",
    "Mining",
    "Nonprofit",
    "Professional Services",
    "Real Estate",
    "Retail",
    "Security Services",
    "Technology",
    "Telecommunications",
    "Travel & Tourism",
    "Utilities",
    "Wholesale",
    "Other",
]

NIGERIA_COUNTRY_NAME = "Nigeria"
DEFAULT_COUNTRY_CODE = "+234"


def validate_application_password(value: str, *, min_length: int = 6) -> str:
    password = str(value or "")
    if len(password) < int(min_length):
        raise serializers.ValidationError(f"Password must be at least {int(min_length)} characters")
    return password


def normalize_signup_phone(country_code: str, phone_number: str) -> str:
    cc_digits = re.sub(r"\D", "", str(country_code or ""))
    phone_digits = re.sub(r"\D", "", str(phone_number or ""))
    if not cc_digits:
        raise serializers.ValidationError("Country code is required")
    if not phone_digits:
        raise serializers.ValidationError("Phone number is required")
    if len(cc_digits) > 4:
        raise serializers.ValidationError("Country code is invalid")

    if cc_digits == "234":
        if phone_digits.startswith("234"):
            phone_digits = phone_digits[3:]
        if phone_digits.startswith("0"):
            phone_digits = phone_digits[1:]
        if len(phone_digits) != 10:
            raise serializers.ValidationError("Enter a valid Nigerian phone number")
    else:
        if len(phone_digits) < 7 or len(phone_digits) > 14:
            raise serializers.ValidationError("Enter a valid phone number")

    return f"+{cc_digits}{phone_digits}"


class CustomerSerializer(serializers.ModelSerializer):
    invoice_count = serializers.SerializerMethodField()
    lifetime_value = serializers.SerializerMethodField()
    last_invoice_date = serializers.SerializerMethodField()
    total_paid_amount = serializers.SerializerMethodField()
    account_status = serializers.SerializerMethodField()
    segment = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "email",
            "phone",
            "billing_address",
            "internal_remarks",
            "created_at",
            "updated_at",
            "is_deleted",
            "deleted_at",
            "invoice_count",
            "lifetime_value",
            "last_invoice_date",
            "total_paid_amount",
            "account_status",
            "segment",
        )
        read_only_fields = ("id", "created_at", "is_deleted", "deleted_at", "updated_at")

    def _can_read_internal_remarks(self) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        return bool(user_has_permission(user, "data.customers.remarks.read"))

    def _can_write_internal_remarks(self) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        return bool(user_has_permission(user, "data.customers.remarks.write"))

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self._can_read_internal_remarks():
            data.pop("internal_remarks", None)
        return data

    def validate(self, attrs):
        if "internal_remarks" in attrs and not self._can_write_internal_remarks():
            raise PermissionDenied("You do not have permission to manage internal customer remarks.")
        return attrs

    def get_invoice_count(self, obj):
        return int(getattr(obj, "invoice_count", 0) or 0)

    def get_lifetime_value(self, obj):
        value = getattr(obj, "lifetime_value", Decimal("0.00")) or Decimal("0.00")
        return str(Decimal(str(value)).quantize(Decimal("0.01")))

    def get_last_invoice_date(self, obj):
        return getattr(obj, "last_invoice_date", None)

    def get_total_paid_amount(self, obj):
        value = getattr(obj, "total_paid_amount", Decimal("0.00")) or Decimal("0.00")
        return str(Decimal(str(value)).quantize(Decimal("0.01")))

    def get_account_status(self, obj):
        if bool(getattr(obj, "is_deleted", False)):
            return "archived"
        invoice_count = int(getattr(obj, "invoice_count", 0) or 0)
        return "active" if invoice_count > 0 else "prospect"

    def get_segment(self, obj):
        invoice_count = int(getattr(obj, "invoice_count", 0) or 0)
        lifetime_value = Decimal(str(getattr(obj, "lifetime_value", Decimal("0.00")) or Decimal("0.00")))
        if invoice_count == 0:
            return "prospect"
        if invoice_count >= 5 or lifetime_value >= Decimal("10000.00"):
            return "vip"
        return "standard"


class CustomerOrderHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ("id", "invoice_number", "issue_date", "due_date", "status", "total_amount")


class CustomerDetailSerializer(CustomerSerializer):
    order_history = serializers.SerializerMethodField()

    class Meta(CustomerSerializer.Meta):
        fields = CustomerSerializer.Meta.fields + ("order_history",)

    def get_order_history(self, obj):
        invoices = (
            obj.invoices.filter(is_deleted=False)
            .only("id", "invoice_number", "issue_date", "due_date", "status", "total_amount")
            .order_by("-issue_date", "-id")
        )
        return CustomerOrderHistorySerializer(invoices, many=True).data


class ItemSerializer(serializers.ModelSerializer):
    specifications = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = (
            "id",
            "type",
            "sku",
            "name",
            "description",
            "unit_price",
            "tax_rate",
            "tax_category",
            "unit_of_measure",
            "stock_quantity",
            "warehouse_location",
            "last_restock_date",
            "created_at",
            "updated_at",
            "is_deleted",
            "deleted_at",
            "specifications",
            "stock_status",
        )
        read_only_fields = ("id", "created_at", "is_deleted", "deleted_at", "updated_at")

    def validate_unit_price(self, value):
        if value is None:
            return value
        if value < 0:
            raise serializers.ValidationError("unit_price must be >= 0")
        return value

    def validate_stock_quantity(self, value):
        if value is None:
            return value
        if value < 0:
            raise serializers.ValidationError("stock_quantity must be >= 0")
        return value

    def validate_tax_rate(self, value):
        if value is None:
            return value
        if value < 0 or value > 100:
            raise serializers.ValidationError("tax_rate must be between 0 and 100")
        return value

    def validate(self, attrs):
        item_type = attrs.get("type") or getattr(self.instance, "type", None)
        stock_quantity = attrs.get("stock_quantity")
        if item_type == "service":
            if stock_quantity is None and self.instance is not None:
                stock_quantity = self.instance.stock_quantity
            if stock_quantity not in (None, 0):
                raise serializers.ValidationError({"stock_quantity": "Services must have stock_quantity = 0"})
        return attrs

    def get_specifications(self, obj):
        return {
            "type": obj.type,
            "description": obj.description,
            "tax_category": obj.tax_category,
            "tax_rate": str(obj.tax_rate),
            "unit_of_measure": obj.unit_of_measure,
        }

    def get_stock_status(self, obj):
        if obj.type == "service":
            return "not_applicable"
        if obj.stock_quantity <= 0:
            return "out_of_stock"
        if obj.stock_quantity < 5:
            return "low_stock"
        return "in_stock"


class ItemInvoiceUsageSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    invoice_status = serializers.CharField(source="invoice.status", read_only=True)
    invoice_issue_date = serializers.DateField(source="invoice.issue_date", read_only=True)

    class Meta:
        model = InvoiceItem
        fields = (
            "id",
            "invoice",
            "invoice_number",
            "invoice_status",
            "invoice_issue_date",
            "quantity",
            "unit_price",
            "line_total",
        )


class ItemDetailSerializer(ItemSerializer):
    recent_invoice_usage = serializers.SerializerMethodField()

    class Meta(ItemSerializer.Meta):
        fields = ItemSerializer.Meta.fields + ("recent_invoice_usage",)

    def get_recent_invoice_usage(self, obj):
        rows = (
            InvoiceItem.objects.filter(item=obj, is_deleted=False, invoice__is_deleted=False)
            .select_related("invoice")
            .only(
                "id",
                "invoice_id",
                "quantity",
                "unit_price",
                "line_total",
                "invoice__invoice_number",
                "invoice__status",
                "invoice__issue_date",
            )
            .order_by("-invoice__issue_date", "-id")[:10]
        )
        return ItemInvoiceUsageSerializer(rows, many=True).data


class InvoiceItemSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_sku = serializers.CharField(source="item.sku", read_only=True)

    class Meta:
        model = InvoiceItem
        fields = (
            "id",
            "invoice",
            "item",
            "item_name",
            "item_sku",
            "description",
            "unit_of_measure",
            "quantity",
            "unit_price",
            "tax_rate",
            "line_subtotal",
            "line_tax",
            "line_total",
            "is_deleted",
            "deleted_at",
            "updated_at",
        )
        read_only_fields = ("id", "is_deleted", "deleted_at", "updated_at")

    def validate_quantity(self, value):
        if value < 1:
            raise serializers.ValidationError("quantity must be >= 1")
        return value

    def validate_unit_price(self, value):
        if value < 0:
            raise serializers.ValidationError("unit_price must be >= 0")
        return value

    def validate_line_total(self, value):
        if value < 0:
            raise serializers.ValidationError("line_total must be >= 0")
        return value

    def validate_tax_rate(self, value):
        if value is None:
            return value
        if value < 0 or value > 100:
            raise serializers.ValidationError("tax_rate must be between 0 and 100")
        return value

    def validate_line_subtotal(self, value):
        if value < 0:
            raise serializers.ValidationError("line_subtotal must be >= 0")
        return value

    def validate_line_tax(self, value):
        if value < 0:
            raise serializers.ValidationError("line_tax must be >= 0")
        return value


class InvoiceSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(read_only=True)
    invoice_items = serializers.SerializerMethodField()
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_email = serializers.EmailField(source="customer.email", read_only=True)
    amount_paid = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    line_item_count = serializers.SerializerMethodField()

    def get_invoice_items(self, obj):
        qs = obj.invoice_items.filter(is_deleted=False)
        return InvoiceItemSerializer(qs, many=True).data

    def get_amount_paid(self, obj):
        value = getattr(obj, "amount_paid", None)
        if value is None:
            value = obj.receipts.filter(is_deleted=False).aggregate(total=Sum("amount_paid"))["total"] or Decimal("0.00")
        return str(value)

    def get_balance_due(self, obj):
        total = Decimal(str(obj.total_amount or 0))
        amount_paid = Decimal(self.get_amount_paid(obj))
        balance = total - amount_paid
        if balance < 0:
            balance = Decimal("0.00")
        return str(balance.quantize(Decimal("0.01")))

    def get_payment_status(self, obj):
        total = Decimal(str(obj.total_amount or 0))
        amount_paid = Decimal(self.get_amount_paid(obj))
        if amount_paid >= total:
            return "paid"
        if amount_paid > 0:
            return "partial"
        return "unpaid"

    def get_line_item_count(self, obj):
        value = getattr(obj, "line_item_count", None)
        if value is not None:
            return int(value)
        return int(obj.invoice_items.filter(is_deleted=False).count())

    def validate_discount_type(self, value):
        allowed = {choice for choice, _ in Invoice.DISCOUNT_TYPE_CHOICES}
        if value not in allowed:
            raise serializers.ValidationError("Invalid discount_type")
        return value

    def validate_discount_value(self, value):
        if value is None:
            return Decimal("0.00")
        if value < 0:
            raise serializers.ValidationError("discount_value must be >= 0")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        discount_type = attrs.get("discount_type", getattr(self.instance, "discount_type", Invoice.DISCOUNT_TYPE_PERCENTAGE))
        discount_value = attrs.get("discount_value", getattr(self.instance, "discount_value", Decimal("0.00")))
        if discount_type == Invoice.DISCOUNT_TYPE_PERCENTAGE and discount_value > Decimal("100"):
            raise serializers.ValidationError({"discount_value": "Percentage discount must be between 0 and 100"})
        return attrs

    class Meta:
        model = Invoice
        fields = (
            "id",
            "invoice_number",
            "customer",
            "customer_name",
            "customer_email",
            "issue_date",
            "due_date",
            "subtotal",
            "discount_type",
            "discount_value",
            "discount_amount",
            "tax_rate",
            "tax_total",
            "total_amount",
            "status",
            "inventory_deducted_at",
            "updated_at",
            "is_deleted",
            "deleted_at",
            "invoice_items",
            "amount_paid",
            "balance_due",
            "payment_status",
            "line_item_count",
        )
        read_only_fields = (
            "id",
            "invoice_number",
            "subtotal",
            "tax_rate",
            "tax_total",
            "total_amount",
            "inventory_deducted_at",
            "is_deleted",
            "deleted_at",
            "updated_at",
        )


class ReceiptSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    invoice_status = serializers.CharField(source="invoice.status", read_only=True)
    invoice_total = serializers.DecimalField(source="invoice.total_amount", max_digits=10, decimal_places=2, read_only=True)
    customer_id = serializers.IntegerField(source="invoice.customer_id", read_only=True)
    customer_name = serializers.CharField(source="invoice.customer.name", read_only=True)
    transaction_timestamp = serializers.DateTimeField(source="updated_at", read_only=True)

    class Meta:
        model = Receipt
        fields = (
            "id",
            "invoice",
            "invoice_number",
            "invoice_status",
            "invoice_total",
            "customer_id",
            "customer_name",
            "amount_paid",
            "payment_date",
            "payment_method",
            "reference_number",
            "updated_at",
            "transaction_timestamp",
            "is_deleted",
            "deleted_at",
        )
        read_only_fields = ("id", "is_deleted", "deleted_at", "updated_at")

    def validate_amount_paid(self, value):
        if value <= 0:
            raise serializers.ValidationError("amount_paid must be > 0")
        return value

    def validate(self, attrs):
        payment_method = attrs.get("payment_method") or getattr(self.instance, "payment_method", None)
        reference_number = attrs.get("reference_number") if "reference_number" in attrs else getattr(self.instance, "reference_number", None)

        if payment_method in ("Card", "Bank Transfer"):
            if not (reference_number and str(reference_number).strip()):
                raise serializers.ValidationError({"reference_number": "reference_number is required for Card and Bank Transfer payments"})

        if reference_number:
            ref = str(reference_number)
            digits_only = "".join(ch for ch in ref if ch.isdigit())
            if len(digits_only) >= 12 and payment_method == "Card":
                raise serializers.ValidationError({"reference_number": "Do not store card numbers. Use an authorization/reference code instead."})

        return attrs


class ReceiptDetailSerializer(ReceiptSerializer):
    linked_invoice = serializers.SerializerMethodField()

    class Meta(ReceiptSerializer.Meta):
        fields = ReceiptSerializer.Meta.fields + ("linked_invoice",)

    def get_linked_invoice(self, obj):
        invoice = getattr(obj, "invoice", None)
        if invoice is None:
            return None
        return {
            "id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "status": invoice.status,
            "issue_date": invoice.issue_date,
            "due_date": invoice.due_date,
            "total_amount": str(invoice.total_amount),
            "customer_id": invoice.customer_id,
            "customer_name": getattr(getattr(invoice, "customer", None), "name", None),
        }


class ExpenseSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source="assigned_to.username", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    source_account_name = serializers.CharField(source="source_account.name", read_only=True)
    source_account_status = serializers.CharField(source="source_account.status", read_only=True)
    source_account = serializers.PrimaryKeyRelatedField(
        queryset=SourceAccount.objects.filter(is_deleted=False),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Expense
        fields = (
            "id",
            "amount",
            "expense_date",
            "category",
            "description",
            "vendor",
            "merchant_reference",
            "project_code",
            "cost_center",
            "source_account",
            "source_account_name",
            "source_account_status",
            "assigned_to",
            "assigned_to_name",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "is_deleted",
            "deleted_at",
        )
        read_only_fields = (
            "id",
            "created_by",
            "created_by_name",
            "created_at",
            "is_deleted",
            "deleted_at",
            "updated_at",
        )

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("amount must be > 0")
        return value

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for field_name in ("description", "merchant_reference"):
            data[field_name] = decrypt_expense_text(getattr(instance, field_name, None))
        return data

    def validate(self, attrs):
        expense_date = attrs.get("expense_date") or getattr(self.instance, "expense_date", None) or timezone.localdate()
        category = str(
            attrs.get("category") if "category" in attrs else getattr(self.instance, "category", "") or ""
        ).strip()
        project_code = str(
            attrs.get("project_code") if "project_code" in attrs else getattr(self.instance, "project_code", "") or ""
        ).strip()
        cost_center = str(
            attrs.get("cost_center") if "cost_center" in attrs else getattr(self.instance, "cost_center", "") or ""
        ).strip()
        chosen_source_account = attrs.get("source_account") if "source_account" in attrs else getattr(self.instance, "source_account", None)
        if not category:
            raise serializers.ValidationError({"category": "category is required"})
        if not project_code and not cost_center:
            raise serializers.ValidationError({"detail": "Either project_code or cost_center is required"})
        if expense_date and expense_date > timezone.localdate() + timedelta(days=1):
            raise serializers.ValidationError({"expense_date": "expense_date cannot be more than one day in the future"})
        if chosen_source_account is not None and chosen_source_account.status != SourceAccount.STATUS_ACTIVE:
            raise serializers.ValidationError({"source_account": "Select an active source account."})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        if request is not None and getattr(request.user, "is_authenticated", False):
            validated_data.setdefault("created_by", request.user)
            validated_data.setdefault("assigned_to", request.user)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        return super().update(instance, validated_data)


class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = "__all__"
        read_only_fields = ("id",)


class SourceAccountSerializer(serializers.ModelSerializer):
    currency_code = serializers.CharField(source="currency.code", read_only=True)
    active_expense_count = serializers.SerializerMethodField()

    class Meta:
        model = SourceAccount
        fields = (
            "id",
            "name",
            "account_type",
            "initial_balance",
            "currency",
            "currency_code",
            "status",
            "active_expense_count",
            "created_at",
            "updated_at",
            "is_deleted",
            "deleted_at",
        )
        read_only_fields = ("id", "currency_code", "active_expense_count", "created_at", "updated_at", "is_deleted", "deleted_at")

    def validate_name(self, value):
        normalized = re.sub(r"\s+", " ", str(value or "").strip())
        if not normalized:
            raise serializers.ValidationError("name is required")
        return normalized

    def validate_initial_balance(self, value):
        if value < 0:
            raise serializers.ValidationError("initial_balance must be >= 0")
        return value

    def get_active_expense_count(self, obj):
        if hasattr(obj, "active_expense_count"):
            return int(obj.active_expense_count or 0)
        return int(obj.expenses.filter(is_deleted=False).count())


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = "__all__"
        read_only_fields = ("id", "as_of")

    def validate(self, attrs):
        base_raw = attrs.get("base_code")
        quote_raw = attrs.get("quote_code")
        base = ((base_raw if base_raw is not None else getattr(self.instance, "base_code", "")) or "").upper()
        quote = ((quote_raw if quote_raw is not None else getattr(self.instance, "quote_code", "")) or "").upper()
        if not base or not quote:
            raise serializers.ValidationError({"detail": "base_code and quote_code are required"})
        if base == quote:
            raise serializers.ValidationError({"detail": "base_code and quote_code must be different"})
        if base_raw is not None:
            attrs["base_code"] = base
        if quote_raw is not None:
            attrs["quote_code"] = quote
        return attrs


class GlobalSettingsSerializer(serializers.ModelSerializer):
    default_currency_code = serializers.CharField(source="default_currency.code", read_only=True)

    class Meta:
        model = GlobalSettings
        fields = "__all__"
        read_only_fields = ("id", "singleton_key", "updated_by", "updated_at", "default_currency_code")

    def validate(self, attrs):
        tax = attrs.get("tax_configuration", {})
        if isinstance(tax, dict):
            tax_type = tax.get("type")
            if tax_type is not None:
                allowed = {"vat", "gst", "sales_tax", "consumption_tax", ""}
                if not (isinstance(tax_type, str) and tax_type in allowed):
                    raise serializers.ValidationError({"tax_configuration": {"type": "Invalid tax type"}})

            rate = tax.get("default_rate")
            if rate not in (None, ""):
                try:
                    rate_num = float(rate)
                except (TypeError, ValueError):
                    raise serializers.ValidationError({"tax_configuration": {"default_rate": "Invalid tax rate"}})
                if rate_num < 0 or rate_num > 100:
                    raise serializers.ValidationError({"tax_configuration": {"default_rate": "Tax rate must be between 0 and 100"}})

        appearance = attrs.get("appearance", {})
        if isinstance(appearance, dict):
            appearance = dict(appearance)
            appearance.pop("logo_url", None)
            appearance.pop("logo_thumbnail_url", None)
            primary = appearance.get("primary_color")
            if primary is not None and not (isinstance(primary, str) and primary.startswith("#") and len(primary) in (4, 7)):
                raise serializers.ValidationError({"appearance": {"primary_color": "Invalid color"}})
            logo_url = appearance.get("logo_url")
            if logo_url not in (None, "") and not isinstance(logo_url, str):
                raise serializers.ValidationError({"appearance": {"logo_url": "Invalid logo URL"}})
            attrs["appearance"] = appearance
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        appearance = dict(data.get("appearance") or {})
        asset = getattr(instance, "appearance_logo", None)
        if asset is not None:
            appearance["logo_url"] = asset.file_url
            appearance["logo_thumbnail_url"] = asset.thumbnail_url
        data["appearance"] = appearance
        return data


class UserSettingsSerializer(serializers.ModelSerializer):
    currency_code = serializers.CharField(source="currency.code", read_only=True)

    class Meta:
        model = UserSettings
        fields = "__all__"
        read_only_fields = ("id", "user", "updated_at", "currency_code")

    def validate(self, attrs):
        for field_name in ("invoice_template", "receipt_template"):
            payload = attrs.get(field_name)
            if isinstance(payload, dict):
                payload = dict(payload)
                payload.pop("logo_url", None)
                payload.pop("logo_thumbnail_url", None)
                attrs[field_name] = payload
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        invoice_template = dict(data.get("invoice_template") or {})
        receipt_template = dict(data.get("receipt_template") or {})
        if getattr(instance, "invoice_logo", None) is not None:
            invoice_template["logo_url"] = instance.invoice_logo.file_url
            invoice_template["logo_thumbnail_url"] = instance.invoice_logo.thumbnail_url
        if getattr(instance, "receipt_logo", None) is not None:
            receipt_template["logo_url"] = instance.receipt_logo.file_url
            receipt_template["logo_thumbnail_url"] = instance.receipt_logo.thumbnail_url
        data["invoice_template"] = invoice_template
        data["receipt_template"] = receipt_template
        return data


class BusinessAccountSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = BusinessAccount
        fields = ("id", "name", "owner", "my_role", "created_at", "updated_at")
        read_only_fields = ("id", "owner", "my_role", "created_at", "updated_at")

    def get_my_role(self, obj):
        req = self.context.get("request") if isinstance(self.context, dict) else None
        user = getattr(req, "user", None)
        if not getattr(user, "is_authenticated", False):
            return None
        roles = set(getattr(user, "roles", []) or [])
        if not roles:
            try:
                from .rbac import user_role_names

                roles = set(user_role_names(user))
            except Exception:
                roles = set()
        if "admin" in roles or "staff" in roles or bool(getattr(user, "is_superuser", False)):
            return "owner"
        row = BusinessMembership.objects.filter(business=obj, user=user).only("role").first()
        return row.role if row else None


class BusinessMembershipSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = BusinessMembership
        fields = ("id", "business", "user", "username", "role", "created_at")
        read_only_fields = ("id", "created_at", "username")


class DocumentDeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentDelivery
        fields = "__all__"
        read_only_fields = ("id", "user", "status", "attempt_count", "last_attempt_at", "next_retry_at", "created_at", "updated_at")


class SavedDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedDocument
        fields = "__all__"
        read_only_fields = (
            "id",
            "user",
            "document_type",
            "invoice",
            "receipt",
            "format",
            "original_filename",
            "file",
            "content_type",
            "sha256",
            "size_bytes",
            "storage_backend",
            "created_at",
            "updated_at",
        )


class PaymentTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentTransaction
        fields = "__all__"
        read_only_fields = (
            "id",
            "created_by",
            "status",
            "reference",
            "provider_reference",
            "provider_transaction_id",
            "payment_url",
            "paid_at",
            "failure_code",
            "failure_message",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        amount = attrs.get("amount")
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount": "amount must be > 0"})
        currency = str(attrs.get("currency_code") or "").strip().upper()
        if not currency:
            raise serializers.ValidationError({"currency_code": "currency_code is required"})
        if len(currency) < 3 or len(currency) > 10:
            raise serializers.ValidationError({"currency_code": "Invalid currency_code"})
        attrs["currency_code"] = currency
        return attrs


class SettingsRollbackSerializer(serializers.Serializer):
    audit_log_id = serializers.IntegerField()

    def validate_audit_log_id(self, value):
        try:
            AuditLog.objects.get(pk=value)
        except AuditLog.DoesNotExist:
            raise serializers.ValidationError("Audit log not found")
        return value


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    password_confirm = serializers.CharField(write_only=True)
    company_name = serializers.CharField(max_length=255)
    country_code = serializers.CharField(max_length=8, default=DEFAULT_COUNTRY_CODE)
    phone_number = serializers.CharField(max_length=30)
    country = serializers.CharField(max_length=80, default=NIGERIA_COUNTRY_NAME)
    accept_terms = serializers.BooleanField()
    website = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_password(self, value):
        return validate_application_password(value, min_length=6)

    def validate(self, attrs):
        if attrs.get("website"):
            raise serializers.ValidationError({"detail": "Invalid submission"})
        attrs["email"] = str(attrs.get("email") or "").strip().lower()
        company_name = str(attrs.get("company_name") or "").strip()
        if not company_name:
            raise serializers.ValidationError({"company_name": "This field is required"})
        attrs["company_name"] = company_name
        country = str(attrs.get("country") or "").strip()
        if country != NIGERIA_COUNTRY_NAME:
            raise serializers.ValidationError({"country": "Country must be Nigeria"})
        attrs["country"] = country
        cc = str(attrs.get("country_code") or DEFAULT_COUNTRY_CODE).strip()
        cc_digits = re.sub(r"\D", "", cc)
        if not cc_digits:
            raise serializers.ValidationError({"country_code": "Country code is required"})
        cc = f"+{cc_digits}"
        attrs["country_code"] = cc
        attrs["phone_number"] = str(attrs.get("phone_number") or "").strip()
        try:
            attrs["phone_e164"] = normalize_signup_phone(attrs["country_code"], attrs["phone_number"])
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"phone_number": exc.detail[0] if isinstance(exc.detail, list) else exc.detail})
        if attrs.get("accept_terms") is not True:
            raise serializers.ValidationError({"accept_terms": "You must accept the terms"})
        if attrs.get("password") != attrs.get("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match"})
        return attrs


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()
    token_type = serializers.CharField(required=False, allow_blank=True)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        return validate_application_password(value, min_length=6)

    def validate(self, attrs):
        if attrs.get("new_password") != attrs.get("new_password_confirm"):
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match"})
        return attrs
