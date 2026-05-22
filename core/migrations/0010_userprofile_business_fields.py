from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_add_ngn_currency"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="company_legal_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="company_registration_number",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="business_industry",
            field=models.CharField(blank=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="tax_identification_number",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="business_address",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="userprofile",
            name="certifications",
            field=models.JSONField(blank=True, default=list),
        ),
    ]

