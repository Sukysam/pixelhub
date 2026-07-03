from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import models
from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone


class Role(models.Model):
    name = models.CharField(max_length=50, unique=True)
    description = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Permission(models.Model):
    code = models.CharField(max_length=120, unique=True)
    description = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.code


class RolePermission(models.Model):
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="permission_roles")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["role", "permission"], name="uniq_role_permission"),
        ]

    def __str__(self):
        return f"{self.role_id}:{self.permission_id}"


class UserRole(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rbac_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_users")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "role"], name="uniq_user_role"),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.role_id}"


class AccessToken(models.Model):
    key = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="access_tokens")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="access_tokens")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(blank=True, null=True)
    revoked_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["key"]),
            models.Index(fields=["revoked_at", "expires_at"]),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.role_id}"


class AdminMfaDevice(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="admin_mfa_device")
    secret = models.CharField(max_length=64)
    confirmed_at = models.DateTimeField(blank=True, null=True)
    last_used_ts = models.BigIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"AdminMfaDevice {self.user_id}"


class SoftDeleteModel(models.Model):
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Customer(SoftDeleteModel):
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    billing_address = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["is_deleted", "name"]),
            models.Index(fields=["is_deleted", "email"]),
            models.Index(fields=["is_deleted", "created_at"]),
        ]

    def __str__(self):
        return self.name


class Item(SoftDeleteModel):
    TYPE_CHOICES = [
        ("product", "Product"),
        ("service", "Service"),
    ]

    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="product")
    sku = models.CharField(max_length=100, blank=True, null=True, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_category = models.CharField(max_length=50, default="standard")
    unit_of_measure = models.CharField(max_length=50, default="pcs")
    stock_quantity = models.IntegerField(default=0)
    warehouse_location = models.CharField(max_length=120, blank=True, null=True)
    last_restock_date = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["is_deleted", "sku"]),
            models.Index(fields=["is_deleted", "name"]),
            models.Index(fields=["is_deleted", "type"]),
            models.Index(fields=["is_deleted", "stock_quantity"]),
            models.Index(fields=["is_deleted", "last_restock_date"]),
        ]

    def __str__(self):
        return self.name


class Invoice(SoftDeleteModel):
    STATUS_CHOICES = [
        ('Draft', 'Draft'),
        ('Sent', 'Sent'),
        ('Paid', 'Paid'),
        ('Overdue', 'Overdue'),
    ]
    DISCOUNT_TYPE_PERCENTAGE = "percentage"
    DISCOUNT_TYPE_FIXED = "fixed"
    DISCOUNT_TYPE_CHOICES = [
        (DISCOUNT_TYPE_PERCENTAGE, "Percentage"),
        (DISCOUNT_TYPE_FIXED, "Fixed amount"),
    ]

    invoice_number = models.CharField(max_length=50, unique=True)
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name='invoices')
    issue_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField(blank=True, null=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_type = models.CharField(max_length=20, choices=DISCOUNT_TYPE_CHOICES, default=DISCOUNT_TYPE_PERCENTAGE)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Draft')
    inventory_deducted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["is_deleted", "invoice_number"]),
            models.Index(fields=["is_deleted", "status"]),
            models.Index(fields=["customer", "issue_date"]),
            models.Index(fields=["customer", "due_date"]),
            models.Index(fields=["is_deleted", "total_amount"]),
        ]

    @property
    def tax_amount(self):
        return self.tax_total

    def __str__(self):
        return f"Invoice {self.invoice_number} - {self.customer.name}"


def evaluate_invoice_payment_status(invoice_total: Any, payment_total: Any = None) -> str:
    if invoice_total is None:
        raise ValueError("invoice_total is required")

    try:
        invoice_amount = Decimal(str(invoice_total))
    except (InvalidOperation, TypeError):
        raise ValueError("invoice_total must be a valid number")
    if not invoice_amount.is_finite():
        raise ValueError("invoice_total must be a finite number")
    if invoice_amount < 0:
        raise ValueError("invoice_total must be >= 0")

    if payment_total is None or (isinstance(payment_total, str) and not payment_total.strip()):
        payments_amount = Decimal("0")
    else:
        try:
            payments_amount = Decimal(str(payment_total))
        except (InvalidOperation, TypeError):
            raise ValueError("payment_total must be a valid number")
        if not payments_amount.is_finite():
            raise ValueError("payment_total must be a finite number")
        if payments_amount < 0:
            raise ValueError("payment_total must be >= 0")

    cents = Decimal("0.01")
    invoice_amount = invoice_amount.quantize(cents, rounding=ROUND_HALF_UP)
    payments_amount = payments_amount.quantize(cents, rounding=ROUND_HALF_UP)
    return "paid" if payments_amount >= invoice_amount else "bal"


class SavedInvoiceView(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_invoice_views")
    name = models.CharField(max_length=80)
    filters = models.JSONField(default=dict, blank=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "name"], name="uniq_saved_invoice_view_user_name"),
        ]
        indexes = [
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return f"SavedInvoiceView {self.user_id}:{self.name}"


class InvoiceItem(SoftDeleteModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='invoice_items')
    item = models.ForeignKey(Item, on_delete=models.CASCADE)
    description = models.TextField(blank=True, null=True)
    unit_of_measure = models.CharField(max_length=50, default="pcs")
    quantity = models.IntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    line_subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_tax = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.quantity}x {self.item.name}"


class Receipt(SoftDeleteModel):
    PAYMENT_METHOD_CHOICES = [
        ('Cash', 'Cash'),
        ('Card', 'Card'),
        ('Bank Transfer', 'Bank Transfer'),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='receipts')
    amount_paid = models.DecimalField(max_digits=10, decimal_places=2)
    payment_date = models.DateField(default=timezone.localdate)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    reference_number = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["is_deleted", "payment_date"]),
            models.Index(fields=["invoice", "payment_date"]),
            models.Index(fields=["payment_method", "payment_date"]),
            models.Index(fields=["reference_number"]),
        ]

    def __str__(self):
        return f"Receipt for Invoice {self.invoice.invoice_number}"


class Expense(SoftDeleteModel):
    APPROVAL_STATUS_DRAFT = "draft"
    APPROVAL_STATUS_SUBMITTED = "submitted"
    APPROVAL_STATUS_APPROVED = "approved"
    APPROVAL_STATUS_REJECTED = "rejected"
    APPROVAL_STATUS_CHOICES = [
        (APPROVAL_STATUS_DRAFT, "Draft"),
        (APPROVAL_STATUS_SUBMITTED, "Submitted"),
        (APPROVAL_STATUS_APPROVED, "Approved"),
        (APPROVAL_STATUS_REJECTED, "Rejected"),
    ]
    POLICY_STATUS_COMPLIANT = "compliant"
    POLICY_STATUS_REVIEW_REQUIRED = "review_required"
    POLICY_STATUS_NON_COMPLIANT = "non_compliant"
    POLICY_STATUS_CHOICES = [
        (POLICY_STATUS_COMPLIANT, "Compliant"),
        (POLICY_STATUS_REVIEW_REQUIRED, "Review required"),
        (POLICY_STATUS_NON_COMPLIANT, "Non-compliant"),
    ]

    amount = models.DecimalField(max_digits=10, decimal_places=2)
    expense_date = models.DateField(default=timezone.localdate)
    category = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    vendor = models.CharField(max_length=255, blank=True, null=True)
    merchant_reference = models.CharField(max_length=120, blank=True, null=True)
    project_code = models.CharField(max_length=120, blank=True, null=True)
    cost_center = models.CharField(max_length=120, blank=True, null=True)
    receipt_file = models.FileField(upload_to="uploads/expenses/receipts/", blank=True, null=True)
    approval_status = models.CharField(max_length=20, choices=APPROVAL_STATUS_CHOICES, default=APPROVAL_STATUS_DRAFT)
    policy_status = models.CharField(max_length=20, choices=POLICY_STATUS_CHOICES, default=POLICY_STATUS_COMPLIANT)
    policy_notes = models.TextField(blank=True, null=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="assigned_expenses",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_expenses",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="approved_expenses",
    )
    approved_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [
            models.Index(fields=["is_deleted", "expense_date"]),
            models.Index(fields=["is_deleted", "category"]),
            models.Index(fields=["is_deleted", "approval_status"]),
            models.Index(fields=["is_deleted", "policy_status"]),
            models.Index(fields=["is_deleted", "assigned_to"]),
            models.Index(fields=["is_deleted", "project_code"]),
            models.Index(fields=["is_deleted", "cost_center"]),
            models.Index(fields=["is_deleted", "created_at"]),
        ]

    def __str__(self):
        return f"Expense {self.amount} on {self.expense_date}"


class InvoiceNumberSequence(models.Model):
    year = models.IntegerField(unique=True)
    last_number = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.year}: {self.last_number}"


class AuditLog(models.Model):
    ACTION_CHOICES = [
        ("create", "Create"),
        ("update", "Update"),
        ("delete", "Delete"),
        ("bulk_delete", "Bulk Delete"),
        ("export", "Export"),
        ("import", "Import"),
        ("security", "Security Event"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.CharField(max_length=64)
    content_object = GenericForeignKey("content_type", "object_id")
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)


class Currency(models.Model):
    code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=100)
    symbol = models.CharField(max_length=10, blank=True, null=True)
    decimal_places = models.IntegerField(default=2)

    def __str__(self):
        return self.code


class ExchangeRate(models.Model):
    base_code = models.CharField(max_length=10)
    quote_code = models.CharField(max_length=10)
    rate = models.DecimalField(max_digits=18, decimal_places=8)
    as_of = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["base_code", "quote_code"], name="uniq_fx_pair"),
        ]

    def __str__(self):
        return f"{self.base_code}/{self.quote_code}"


class GlobalSettings(models.Model):
    singleton_key = models.CharField(max_length=20, unique=True, default="global")
    default_currency = models.ForeignKey(Currency, blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    tax_configuration = models.JSONField(default=dict, blank=True)
    appearance = models.JSONField(default=dict, blank=True)
    appearance_logo = models.ForeignKey("LogoAsset", blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    tax_identification_number = models.CharField(max_length=100, blank=True, null=True)
    allow_user_overrides = models.BooleanField(default=True)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return "Global Settings"


class UserSettings(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="settings")
    country = models.CharField(max_length=2, blank=True, null=True)
    currency = models.ForeignKey(Currency, blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    language = models.CharField(max_length=10, default="en")
    date_format = models.CharField(max_length=40, default="YYYY-MM-DD")
    number_format = models.CharField(max_length=40, default="1,234.56")
    notifications = models.JSONField(default=dict, blank=True)
    invoice_template = models.JSONField(default=dict, blank=True)
    receipt_template = models.JSONField(default=dict, blank=True)
    invoice_logo = models.ForeignKey("LogoAsset", blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    receipt_logo = models.ForeignKey("LogoAsset", blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Settings for {self.user_id}"


class LogoAsset(models.Model):
    SCOPE_GLOBAL_APPEARANCE = "global_appearance"
    SCOPE_INVOICE_TEMPLATE = "invoice_template"
    SCOPE_RECEIPT_TEMPLATE = "receipt_template"
    SCOPE_CHOICES = [
        (SCOPE_GLOBAL_APPEARANCE, "Global appearance"),
        (SCOPE_INVOICE_TEMPLATE, "Invoice template"),
        (SCOPE_RECEIPT_TEMPLATE, "Receipt template"),
    ]

    scope = models.CharField(max_length=40, choices=SCOPE_CHOICES)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    original_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="uploads/logos/")
    thumbnail = models.FileField(upload_to="uploads/logos/", blank=True, null=True)
    content_type = models.CharField(max_length=100)
    sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(blank=True, null=True)
    height = models.PositiveIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def file_url(self):
        return self.file.url if self.file else None

    @property
    def thumbnail_url(self):
        if self.thumbnail:
            return self.thumbnail.url
        return self.file_url

    def __str__(self):
        return f"{self.scope}:{self.original_name}"


class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    full_name = models.CharField(max_length=255, blank=True, null=True)
    phone = models.CharField(max_length=30, blank=True, null=True)
    company_legal_name = models.CharField(max_length=255, blank=True, null=True)
    company_registration_number = models.CharField(max_length=100, blank=True, null=True)
    business_industry = models.CharField(max_length=120, blank=True, null=True)
    business_address = models.TextField(blank=True, null=True)
    certifications = models.JSONField(default=list, blank=True)
    terms_accepted_at = models.DateTimeField(blank=True, null=True)
    email_verified_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile for {self.user_id}"


class SocialAuthConnection(models.Model):
    PROVIDER_CHOICES = [
        ("google", "Google"),
        ("facebook", "Facebook"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="social_auth_connections")
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    provider_user_id = models.CharField(max_length=255)
    email = models.EmailField(blank=True, null=True)
    display_name = models.CharField(max_length=255, blank=True, null=True)
    avatar_url = models.URLField(blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_login_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "provider_user_id"], name="uniq_social_provider_subject"),
            models.UniqueConstraint(fields=["user", "provider"], name="uniq_social_user_provider"),
        ]
        indexes = [
            models.Index(fields=["user", "provider"]),
            models.Index(fields=["provider", "email"]),
        ]

    def __str__(self):
        return f"SocialAuthConnection {self.provider}:{self.user_id}"


class BusinessAccount(models.Model):
    name = models.CharField(max_length=255)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_business_accounts")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"BusinessAccount {self.id}:{self.name}"


class BusinessMembership(models.Model):
    ROLE_CHOICES = [
        ("owner", "Owner"),
        ("admin", "Admin"),
        ("member", "Member"),
        ("viewer", "Viewer"),
    ]

    business = models.ForeignKey(BusinessAccount, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="business_memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["business", "user"], name="uniq_business_membership"),
        ]
        indexes = [
            models.Index(fields=["user", "business"]),
        ]

    def __str__(self):
        return f"BusinessMembership {self.business_id}:{self.user_id}:{self.role}"

class EmailVerificationToken(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_verification_tokens")
    token = models.CharField(max_length=128, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["token"]),
        ]

    def __str__(self):
        return f"EmailVerificationToken {self.user_id}"


class AdminUserInvitation(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="admin_invitation")
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=models.SET_NULL, related_name="+")
    token_key = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    confirmation_email_sent_at = models.DateTimeField(blank=True, null=True)
    accepted_at = models.DateTimeField(blank=True, null=True)
    password_reset_completed_at = models.DateTimeField(blank=True, null=True)
    activated_at = models.DateTimeField(blank=True, null=True)
    welcome_email_sent_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "expires_at"]),
            models.Index(fields=["token_key"]),
        ]

    def __str__(self):
        return f"AdminUserInvitation {self.user_id}"


class DocumentDelivery(models.Model):
    DOCUMENT_TYPE_CHOICES = [
        ("invoice", "Invoice"),
        ("receipt", "Receipt"),
    ]
    CHANNEL_CHOICES = [
        ("print", "Print"),
        ("email", "Email"),
        ("share", "Share Link"),
    ]
    FORMAT_CHOICES = [
        ("pdf", "PDF"),
        ("html", "HTML"),
        ("text", "Text"),
    ]
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("sending", "Sending"),
        ("sent", "Sent"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="document_deliveries")
    document_type = models.CharField(max_length=20, choices=DOCUMENT_TYPE_CHOICES)
    invoice = models.ForeignKey(Invoice, blank=True, null=True, on_delete=models.CASCADE, related_name="deliveries")
    receipt = models.ForeignKey(Receipt, blank=True, null=True, on_delete=models.CASCADE, related_name="deliveries")
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default="pdf")
    to_email = models.EmailField(blank=True, null=True)
    to_phone = models.CharField(max_length=32, blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    attempt_count = models.IntegerField(default=0)
    last_attempt_at = models.DateTimeField(blank=True, null=True)
    next_retry_at = models.DateTimeField(blank=True, null=True)
    last_error_code = models.CharField(max_length=80, blank=True, null=True)
    last_error_message = models.CharField(max_length=255, blank=True, null=True)
    provider_message_id = models.CharField(max_length=120, blank=True, null=True)
    download_token_hash = models.CharField(max_length=64, blank=True, null=True)
    download_expires_at = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["document_type", "invoice", "created_at"]),
            models.Index(fields=["document_type", "receipt", "created_at"]),
            models.Index(fields=["status", "next_retry_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(invoice__isnull=False, receipt__isnull=True)
                    | models.Q(invoice__isnull=True, receipt__isnull=False)
                ),
                name="chk_delivery_one_document",
            ),
        ]

    def __str__(self):
        return f"DocumentDelivery {self.id} {self.document_type}:{self.channel}:{self.status}"


class PaymentTransaction(models.Model):
    PROVIDER_CHOICES = [
        ("bank_transfer", "Bank Transfer"),
        ("opay", "OPay"),
        ("flutterwave", "Flutterwave"),
        ("paystack", "Paystack"),
    ]
    STATUS_CHOICES = [
        ("initiated", "Initiated"),
        ("pending", "Pending"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payment_transactions")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, blank=True, null=True, on_delete=models.SET_NULL, related_name="payment_transactions"
    )
    provider = models.CharField(max_length=30, choices=PROVIDER_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="initiated")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency_code = models.CharField(max_length=10)
    reference = models.CharField(max_length=80, unique=True)
    provider_reference = models.CharField(max_length=120, blank=True, null=True)
    provider_transaction_id = models.CharField(max_length=120, blank=True, null=True)
    payment_url = models.TextField(blank=True, null=True)
    paid_at = models.DateTimeField(blank=True, null=True)
    failure_code = models.CharField(max_length=80, blank=True, null=True)
    failure_message = models.CharField(max_length=255, blank=True, null=True)
    idempotency_key_hash = models.CharField(max_length=64, blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["invoice", "created_at"]),
            models.Index(fields=["provider", "status", "created_at"]),
            models.Index(fields=["provider_reference"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["invoice", "provider", "idempotency_key_hash"],
                name="uniq_payment_tx_invoice_provider_idem",
            )
        ]

    def __str__(self):
        return f"PaymentTransaction {self.provider}:{self.reference}:{self.status}"


class PaymentWebhookEvent(models.Model):
    PROVIDER_CHOICES = PaymentTransaction.PROVIDER_CHOICES
    STATUS_CHOICES = [
        ("received", "Received"),
        ("processed", "Processed"),
        ("ignored", "Ignored"),
        ("failed", "Failed"),
    ]

    provider = models.CharField(max_length=30, choices=PROVIDER_CHOICES)
    event_id = models.CharField(max_length=160, blank=True, null=True)
    reference = models.CharField(max_length=120, blank=True, null=True)
    signature_valid = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="received")
    error_message = models.CharField(max_length=255, blank=True, null=True)
    headers = models.JSONField(default=dict, blank=True)
    payload = models.JSONField(default=dict, blank=True)
    raw_body = models.TextField(blank=True, null=True)
    received_at = models.DateTimeField(default=timezone.now)
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["provider", "received_at"]),
            models.Index(fields=["provider", "reference"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_payment_webhook_provider_event_id")
        ]

    def __str__(self):
        return f"PaymentWebhookEvent {self.provider}:{self.event_id or ''}:{self.status}"
