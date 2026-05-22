from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0012_rbac_models_and_seed"),
    ]

    operations = [
        migrations.CreateModel(
            name="SavedInvoiceView",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80)),
                ("filters", models.JSONField(blank=True, default=dict)),
                ("is_default", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(default=timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="saved_invoice_views", to=settings.AUTH_USER_MODEL),
                ),
            ],
            options={
                "indexes": [models.Index(fields=["user", "created_at"], name="core_savedin_user_id_8c84d4_idx")],
            },
        ),
        migrations.AddConstraint(
            model_name="savedinvoiceview",
            constraint=models.UniqueConstraint(fields=("user", "name"), name="uniq_saved_invoice_view_user_name"),
        ),
    ]

