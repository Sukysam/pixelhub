from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0013_saved_invoice_view"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentDelivery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("document_type", models.CharField(choices=[("invoice", "Invoice"), ("receipt", "Receipt")], max_length=20)),
                ("channel", models.CharField(choices=[("print", "Print"), ("email", "Email"), ("whatsapp", "WhatsApp")], max_length=20)),
                ("format", models.CharField(choices=[("pdf", "PDF"), ("html", "HTML"), ("text", "Text")], default="pdf", max_length=10)),
                ("to_email", models.EmailField(blank=True, max_length=254, null=True)),
                ("to_phone", models.CharField(blank=True, max_length=32, null=True)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("sending", "Sending"), ("sent", "Sent"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="queued", max_length=20)),
                ("attempt_count", models.IntegerField(default=0)),
                ("last_attempt_at", models.DateTimeField(blank=True, null=True)),
                ("next_retry_at", models.DateTimeField(blank=True, null=True)),
                ("last_error_code", models.CharField(blank=True, max_length=80, null=True)),
                ("last_error_message", models.CharField(blank=True, max_length=255, null=True)),
                ("provider_message_id", models.CharField(blank=True, max_length=120, null=True)),
                ("download_token_hash", models.CharField(blank=True, max_length=64, null=True)),
                ("download_expires_at", models.DateTimeField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="deliveries", to="core.invoice")),
                ("receipt", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="deliveries", to="core.receipt")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="document_deliveries", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [
                    models.Index(fields=["document_type", "invoice", "created_at"], name="core_docume_document_47d4a9_idx"),
                    models.Index(fields=["document_type", "receipt", "created_at"], name="core_docume_document_5b1e9f_idx"),
                    models.Index(fields=["status", "next_retry_at"], name="core_docume_status_7b4d89_idx"),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="documentdelivery",
            constraint=models.CheckConstraint(
                check=(
                    models.Q(invoice__isnull=False, receipt__isnull=True)
                    | models.Q(invoice__isnull=True, receipt__isnull=False)
                ),
                name="chk_delivery_one_document",
            ),
        ),
        migrations.CreateModel(
            name="PaymentTransaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("bank_transfer", "Bank Transfer"), ("opay", "OPay"), ("flutterwave", "Flutterwave"), ("paystack", "Paystack")], max_length=30)),
                ("status", models.CharField(choices=[("initiated", "Initiated"), ("pending", "Pending"), ("succeeded", "Succeeded"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="initiated", max_length=20)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("currency_code", models.CharField(max_length=10)),
                ("reference", models.CharField(max_length=80, unique=True)),
                ("provider_reference", models.CharField(blank=True, max_length=120, null=True)),
                ("provider_transaction_id", models.CharField(blank=True, max_length=120, null=True)),
                ("payment_url", models.TextField(blank=True, null=True)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("failure_code", models.CharField(blank=True, max_length=80, null=True)),
                ("failure_message", models.CharField(blank=True, max_length=255, null=True)),
                ("idempotency_key_hash", models.CharField(blank=True, max_length=64, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payment_transactions", to=settings.AUTH_USER_MODEL)),
                ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payment_transactions", to="core.invoice")),
            ],
        ),
        migrations.AddIndex(
            model_name="paymenttransaction",
            index=models.Index(fields=["invoice", "created_at"], name="core_payme_invoice_2ae79b_idx"),
        ),
        migrations.AddIndex(
            model_name="paymenttransaction",
            index=models.Index(fields=["provider", "status", "created_at"], name="core_payme_provider_3de9c1_idx"),
        ),
        migrations.AddIndex(
            model_name="paymenttransaction",
            index=models.Index(fields=["provider_reference"], name="core_payme_provider_1b7f1d_idx"),
        ),
        migrations.AddConstraint(
            model_name="paymenttransaction",
            constraint=models.UniqueConstraint(fields=("invoice", "provider", "idempotency_key_hash"), name="uniq_payment_tx_invoice_provider_idem"),
        ),
        migrations.CreateModel(
            name="PaymentWebhookEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("bank_transfer", "Bank Transfer"), ("opay", "OPay"), ("flutterwave", "Flutterwave"), ("paystack", "Paystack")], max_length=30)),
                ("event_id", models.CharField(blank=True, max_length=160, null=True)),
                ("reference", models.CharField(blank=True, max_length=120, null=True)),
                ("signature_valid", models.BooleanField(default=False)),
                ("status", models.CharField(choices=[("received", "Received"), ("processed", "Processed"), ("ignored", "Ignored"), ("failed", "Failed")], default="received", max_length=20)),
                ("error_message", models.CharField(blank=True, max_length=255, null=True)),
                ("headers", models.JSONField(blank=True, default=dict)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("raw_body", models.TextField(blank=True, null=True)),
                ("received_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
            ],
        ),
        migrations.AddIndex(
            model_name="paymentwebhookevent",
            index=models.Index(fields=["provider", "received_at"], name="core_payme_provider_1445b0_idx"),
        ),
        migrations.AddIndex(
            model_name="paymentwebhookevent",
            index=models.Index(fields=["provider", "reference"], name="core_payme_provider_3e3a05_idx"),
        ),
        migrations.AddConstraint(
            model_name="paymentwebhookevent",
            constraint=models.UniqueConstraint(fields=("provider", "event_id"), name="uniq_payment_webhook_provider_event_id"),
        ),
    ]
