from django.contrib import admin
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
    UserProfile,
    SocialAuthConnection,
    AuditLog,
    EmailVerificationToken,
)


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 1


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('name', 'email', 'phone', 'created_at')
    search_fields = ('name', 'email', 'phone')


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'sku', 'unit_price', 'stock_quantity', 'created_at')
    search_fields = ('name', 'sku')


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ('invoice_number', 'customer', 'issue_date', 'status', 'total_amount')
    list_filter = ('status', 'issue_date')
    search_fields = ('invoice_number', 'customer__name')
    inlines = [InvoiceItemInline]


@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = ('invoice', 'amount_paid', 'payment_date', 'payment_method', 'reference_number')
    list_filter = ('payment_date', 'payment_method')
    search_fields = ('invoice__invoice_number', 'reference_number')


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('amount', 'expense_date', 'category', 'vendor', 'source_account')
    list_filter = ('expense_date', 'category', 'source_account')
    search_fields = ('description', 'vendor', 'category')


@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "symbol", "decimal_places")
    search_fields = ("code", "name")


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ("base_code", "quote_code", "rate", "as_of")
    list_filter = ("base_code", "quote_code")
    search_fields = ("base_code", "quote_code")


@admin.register(GlobalSettings)
class GlobalSettingsAdmin(admin.ModelAdmin):
    list_display = ("singleton_key", "default_currency", "allow_user_overrides", "updated_at", "updated_by")


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "country", "currency", "language", "updated_at")
    search_fields = ("user__username", "user__email")


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "company_legal_name", "full_name", "phone", "terms_accepted_at", "email_verified_at", "updated_at")
    search_fields = ("user__username", "user__email", "company_legal_name", "full_name", "phone")
    list_filter = ("email_verified_at", "terms_accepted_at")


@admin.register(SocialAuthConnection)
class SocialAuthConnectionAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "provider_user_id", "email", "display_name", "last_login_at", "created_at")
    search_fields = ("user__username", "user__email", "provider_user_id", "email", "display_name")
    list_filter = ("provider", "created_at", "last_login_at")


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "created_at", "expires_at", "used_at", "token")
    search_fields = ("user__username", "user__email", "token")
    list_filter = ("used_at", "expires_at", "created_at")
    readonly_fields = ("user", "token", "created_at", "expires_at", "used_at")
    ordering = ("-created_at", "-id")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "content_type", "object_id", "user")
    list_filter = ("action", "content_type", "created_at")
    search_fields = ("object_id", "user__username", "user__email")
    readonly_fields = ("user", "action", "content_type", "object_id", "changes", "created_at")
    ordering = ("-created_at", "-id")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
