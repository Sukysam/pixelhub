import re
from django.conf import settings
from rest_framework import serializers
from .models import (
    Customer,
    Item,
    Invoice,
    InvoiceItem,
    Receipt,
    Expense,
    Currency,
    ExchangeRate,
    GlobalSettings,
    UserSettings,
    AuditLog,
    DocumentDelivery,
    PaymentTransaction,
    BusinessAccount,
    BusinessMembership,
)

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


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = '__all__'
        read_only_fields = ("id", "created_at", "is_deleted", "deleted_at", "updated_at")


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Item
        fields = '__all__'
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


class InvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = '__all__'
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

    def get_invoice_items(self, obj):
        qs = obj.invoice_items.filter(is_deleted=False)
        return InvoiceItemSerializer(qs, many=True).data

    class Meta:
        model = Invoice
        fields = '__all__'
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
    class Meta:
        model = Receipt
        fields = '__all__'
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


class ExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ("id", "created_at", "is_deleted", "deleted_at", "updated_at")

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("amount must be > 0")
        return value


class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = "__all__"
        read_only_fields = ("id",)


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
            primary = appearance.get("primary_color")
            if primary is not None and not (isinstance(primary, str) and primary.startswith("#") and len(primary) in (4, 7)):
                raise serializers.ValidationError({"appearance": {"primary_color": "Invalid color"}})
            logo_url = appearance.get("logo_url")
            if logo_url not in (None, "") and not isinstance(logo_url, str):
                raise serializers.ValidationError({"appearance": {"logo_url": "Invalid logo URL"}})
        return attrs


class UserSettingsSerializer(serializers.ModelSerializer):
    currency_code = serializers.CharField(source="currency.code", read_only=True)

    class Meta:
        model = UserSettings
        fields = "__all__"
        read_only_fields = ("id", "user", "updated_at", "currency_code")


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
    full_name = serializers.CharField(max_length=255)
    phone = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=30)
    company_legal_name = serializers.CharField(max_length=255)
    company_registration_number = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=100)
    business_industry = serializers.CharField(max_length=120)
    business_address = serializers.CharField(max_length=2000)
    certifications = serializers.ListField(child=serializers.CharField(max_length=120), required=False, allow_empty=True)
    accept_terms = serializers.BooleanField()
    website = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters")
        if re.search(r"[A-Z]", value) is None:
            raise serializers.ValidationError("Password must include an uppercase letter")
        if re.search(r"[a-z]", value) is None:
            raise serializers.ValidationError("Password must include a lowercase letter")
        if re.search(r"[0-9]", value) is None:
            raise serializers.ValidationError("Password must include a number")
        if re.search(r"[^A-Za-z0-9]", value) is None:
            raise serializers.ValidationError("Password must include a special character")
        return value

    def validate(self, attrs):
        if attrs.get("website"):
            raise serializers.ValidationError({"detail": "Invalid submission"})
        for key in ("company_legal_name", "business_industry", "business_address"):
            val = str(attrs.get(key) or "").strip()
            if not val:
                raise serializers.ValidationError({key: "This field is required"})
            attrs[key] = val
        if attrs["business_industry"] not in BUSINESS_INDUSTRY_CHOICES:
            raise serializers.ValidationError({"business_industry": "Invalid business type / industry"})
        reg = attrs.get("company_registration_number")
        reg_clean = str(reg or "").strip()
        attrs["company_registration_number"] = reg_clean or None
        certs = attrs.get("certifications")
        if certs is not None:
            cleaned = []
            for c in certs:
                s = str(c or "").strip()
                if s:
                    cleaned.append(s)
            attrs["certifications"] = cleaned
        if attrs.get("accept_terms") is not True:
            raise serializers.ValidationError({"accept_terms": "You must accept the terms"})
        if attrs.get("password") != attrs.get("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match"})
        return attrs


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        if len(value) < 8:
            raise serializers.ValidationError("Password must be at least 8 characters")
        if re.search(r"[A-Z]", value) is None:
            raise serializers.ValidationError("Password must include an uppercase letter")
        if re.search(r"[a-z]", value) is None:
            raise serializers.ValidationError("Password must include a lowercase letter")
        if re.search(r"[0-9]", value) is None:
            raise serializers.ValidationError("Password must include a number")
        if re.search(r"[^A-Za-z0-9]", value) is None:
            raise serializers.ValidationError("Password must include a special character")
        return value

    def validate(self, attrs):
        if attrs.get("new_password") != attrs.get("new_password_confirm"):
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match"})
        return attrs
