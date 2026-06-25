from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_rename_core_access_user_id_4c87f7_idx_core_access_user_id_962db7_idx_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="SocialAuthConnection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("google", "Google"), ("facebook", "Facebook")], max_length=20)),
                ("provider_user_id", models.CharField(max_length=255)),
                ("email", models.EmailField(blank=True, max_length=254, null=True)),
                ("display_name", models.CharField(blank=True, max_length=255, null=True)),
                ("avatar_url", models.URLField(blank=True, null=True)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_login_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="social_auth_connections", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [
                    models.Index(fields=["user", "provider"], name="core_social_user_id_61c5dc_idx"),
                    models.Index(fields=["provider", "email"], name="core_social_provide_12ba57_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(fields=("provider", "provider_user_id"), name="uniq_social_provider_subject"),
                    models.UniqueConstraint(fields=("user", "provider"), name="uniq_social_user_provider"),
                ],
            },
        ),
    ]
