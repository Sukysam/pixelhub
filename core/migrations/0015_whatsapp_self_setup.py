import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0014_document_delivery_and_payments"),
    ]

    operations = [
        migrations.CreateModel(
            name="BusinessAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="owned_business_accounts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="WhatsAppIntegration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(default="WhatsApp", max_length=120)),
                ("graph_api_version", models.CharField(default="v19.0", max_length=20)),
                ("phone_number_id", models.CharField(max_length=64)),
                ("waba_id", models.CharField(blank=True, max_length=64, null=True)),
                ("access_token", models.TextField(blank=True, null=True)),
                ("app_secret", models.CharField(blank=True, max_length=255, null=True)),
                ("webhook_verify_token", models.CharField(blank=True, max_length=255, null=True)),
                ("webhook_public_id", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("tos_accepted_at", models.DateTimeField(blank=True, null=True)),
                ("last_test_at", models.DateTimeField(blank=True, null=True)),
                ("last_test_ok", models.BooleanField(default=False)),
                ("last_test_error", models.CharField(blank=True, max_length=255, null=True)),
                ("last_webhook_received_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "business",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="whatsapp_integrations",
                        to="core.businessaccount",
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["business", "created_at"], name="core_whatsa_busines_6c3d04_idx"),
                    models.Index(fields=["phone_number_id"], name="core_whatsa_phone_n_916b3b_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="BusinessMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "role",
                    models.CharField(
                        choices=[("owner", "Owner"), ("admin", "Admin"), ("member", "Member"), ("viewer", "Viewer")],
                        max_length=20,
                    ),
                ),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "business",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="core.businessaccount"
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="business_memberships",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["user", "business"], name="core_busine_user_id_1d0d7f_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="WhatsAppTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("language", models.CharField(default="en_US", max_length=20)),
                ("status", models.CharField(blank=True, max_length=40, null=True)),
                ("category", models.CharField(blank=True, max_length=40, null=True)),
                ("components", models.JSONField(blank=True, default=list)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "integration",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="templates", to="core.whatsappintegration"
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["integration", "updated_at"], name="core_whatsa_integra_4a829a_idx"),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="businessmembership",
            constraint=models.UniqueConstraint(fields=("business", "user"), name="uniq_business_membership"),
        ),
        migrations.AddConstraint(
            model_name="whatsappintegration",
            constraint=models.UniqueConstraint(fields=("phone_number_id",), name="uniq_whatsapp_phone_number_id"),
        ),
        migrations.AddConstraint(
            model_name="whatsapptemplate",
            constraint=models.UniqueConstraint(fields=("integration", "name", "language"), name="uniq_whatsapp_template"),
        ),
        migrations.AddField(
            model_name="documentdelivery",
            name="whatsapp_integration",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="document_deliveries",
                to="core.whatsappintegration",
            ),
        ),
    ]

