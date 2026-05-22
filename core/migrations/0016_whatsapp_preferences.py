from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_whatsapp_self_setup"),
    ]

    operations = [
        migrations.CreateModel(
            name="WhatsAppMessagingPreference",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("auto_send_invoice_on_sent", models.BooleanField(default=False)),
                ("auto_send_receipt_on_created", models.BooleanField(default=False)),
                ("use_templates", models.BooleanField(default=False)),
                ("invoice_template_name", models.CharField(blank=True, max_length=120, null=True)),
                ("receipt_template_name", models.CharField(blank=True, max_length=120, null=True)),
                ("template_language", models.CharField(default="en_US", max_length=20)),
                ("include_download_link", models.BooleanField(default=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "integration",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE, related_name="preferences", to="core.whatsappintegration"
                    ),
                ),
            ],
        ),
    ]

