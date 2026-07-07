from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CustomerViewSet,
    ItemViewSet,
    InvoiceViewSet,
    InvoiceItemViewSet,
    ReceiptViewSet,
    ExpenseViewSet,
    SourceAccountViewSet,
    CurrencyViewSet,
    ExchangeRateViewSet,
    DashboardViewSet,
    ReportsViewSet,
    PaymentsReportApi,
    FinanceViewSet,
    GlobalSettingsApi,
    MySettingsApi,
    SettingsRollbackApi,
    CountryDefaultsApi,
    CurrencySuggestionApi,
    GeoDetectApi,
    EffectiveSettingsApi,
    SettingsAuditLogApi,
    CurrencyConvertApi,
    AdminUsersApi,
    AdminRolesApi,
    AdminAuditLogsApi,
    AdminOAuthStatusApi,
    AdminRuntimeDiagnosticsApi,
    AdminLogoUploadApi,
    SettingsLogoUploadApi,
    AdminEmailVerificationMetricsApi,
    AdminSendTestEmailApi,
    MeApi,
    TokenApi,
    RegisterApi,
    VerifyEmailApi,
    ResendVerificationApi,
    LogoutApi,
    PasswordResetApi,
    PasswordResetConfirmApi,
    GoogleOAuthStartApi,
    GoogleOAuthCallbackApi,
    FacebookOAuthStartApi,
    FacebookOAuthCallbackApi,
    SocialConnectionsApi,
    InvoiceSavedViewsApi,
    InvoiceSavedViewDetailApi,
    ImportErrorLogDownloadApi,
    DocumentDeliveryViewSet,
    SavedDocumentViewSet,
    PaymentTransactionViewSet,
    PrinterListApi,
    PaystackWebhookApi,
    FlutterwaveWebhookApi,
    OPayWebhookApi,
    BankTransferWebhookApi,
    BusinessAccountViewSet,
)

router = DefaultRouter()
router.register(r'customers', CustomerViewSet)
router.register(r'items', ItemViewSet)
router.register(r'invoices', InvoiceViewSet)
router.register(r'invoice-items', InvoiceItemViewSet)
router.register(r'receipts', ReceiptViewSet)
router.register(r'expenses', ExpenseViewSet)
router.register(r'source-accounts', SourceAccountViewSet)
router.register(r'currencies', CurrencyViewSet)
router.register(r'exchange-rates', ExchangeRateViewSet)
router.register(r'dashboard', DashboardViewSet, basename='dashboard')
router.register(r'reports', ReportsViewSet, basename='reports')
router.register(r'finance', FinanceViewSet, basename='finance')
router.register(r'documents/deliveries', DocumentDeliveryViewSet, basename='document-delivery')
router.register(r'documents/saved', SavedDocumentViewSet, basename='saved-document')
router.register(r'payments/transactions', PaymentTransactionViewSet, basename='payment-transaction')
router.register(r'business-accounts', BusinessAccountViewSet, basename='business-account')

urlpatterns = [
    path("auth/token/", TokenApi.as_view(), name="api-token"),
    path("auth/me/", MeApi.as_view(), name="api-me"),
    path("auth/logout/", LogoutApi.as_view(), name="auth-logout"),
    path("auth/register/", RegisterApi.as_view(), name="auth-register"),
    path("auth/verify-email/", VerifyEmailApi.as_view(), name="auth-verify-email"),
    path("auth/resend-verification/", ResendVerificationApi.as_view(), name="auth-resend-verification"),
    path("auth/password-reset/", PasswordResetApi.as_view(), name="auth-password-reset"),
    path("auth/password-reset-confirm/", PasswordResetConfirmApi.as_view(), name="auth-password-reset-confirm"),
    path("auth/social/connections/", SocialConnectionsApi.as_view(), name="auth-social-connections"),
    path("auth/google/start/", GoogleOAuthStartApi.as_view(), name="auth-google-start"),
    path("auth/google/callback/", GoogleOAuthCallbackApi.as_view(), name="auth-google-callback"),
    path("auth/facebook/start/", FacebookOAuthStartApi.as_view(), name="auth-facebook-start"),
    path("auth/facebook/callback/", FacebookOAuthCallbackApi.as_view(), name="auth-facebook-callback"),
    path("settings/global/", GlobalSettingsApi.as_view(), name="settings-global"),
    path("settings/me/", MySettingsApi.as_view(), name="settings-me"),
    path("settings/effective/", EffectiveSettingsApi.as_view(), name="settings-effective"),
    path("settings/logo/upload/", SettingsLogoUploadApi.as_view(), name="settings-logo-upload"),
    path("settings/audit/", SettingsAuditLogApi.as_view(), name="settings-audit"),
    path("settings/rollback/", SettingsRollbackApi.as_view(), name="settings-rollback"),
    path("settings/country-defaults/", CountryDefaultsApi.as_view(), name="settings-country-defaults"),
    path("settings/currency-suggestion/", CurrencySuggestionApi.as_view(), name="settings-currency-suggestion"),
    path("settings/geo/", GeoDetectApi.as_view(), name="settings-geo"),
    path("settings/convert/", CurrencyConvertApi.as_view(), name="settings-convert"),
    path("admin/users/", AdminUsersApi.as_view(), name="admin-users"),
    path("admin/roles/", AdminRolesApi.as_view(), name="admin-roles"),
    path("admin/audit-logs/", AdminAuditLogsApi.as_view(), name="admin-audit-logs"),
    path("admin/oauth/status/", AdminOAuthStatusApi.as_view(), name="admin-oauth-status"),
    path("admin/runtime/diagnostics/", AdminRuntimeDiagnosticsApi.as_view(), name="admin-runtime-diagnostics"),
    path("admin/logo/upload/", AdminLogoUploadApi.as_view(), name="admin-logo-upload"),
    path("admin/email/metrics/", AdminEmailVerificationMetricsApi.as_view(), name="admin-email-metrics"),
    path("admin/email/test/", AdminSendTestEmailApi.as_view(), name="admin-email-test"),
    path("print/printers/", PrinterListApi.as_view(), name="print-printers"),
    path("payments/webhooks/paystack/", PaystackWebhookApi.as_view(), name="payments-webhook-paystack"),
    path("payments/webhooks/flutterwave/", FlutterwaveWebhookApi.as_view(), name="payments-webhook-flutterwave"),
    path("payments/webhooks/opay/", OPayWebhookApi.as_view(), name="payments-webhook-opay"),
    path("payments/webhooks/bank-transfer/", BankTransferWebhookApi.as_view(), name="payments-webhook-bank-transfer"),
    path("payments/report/", PaymentsReportApi.as_view(), name="payments-report"),
    path("invoices/views/", InvoiceSavedViewsApi.as_view(), name="invoice-saved-views"),
    path("invoices/views/<int:view_id>/", InvoiceSavedViewDetailApi.as_view(), name="invoice-saved-view-detail"),
    path("imports/error-log/<uuid:token>/", ImportErrorLogDownloadApi.as_view(), name="import-error-log"),
    path('', include(router.urls)),
]
