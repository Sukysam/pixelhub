from django.db import migrations, models


def copy_tax_id_to_global_settings(apps, schema_editor):
    GlobalSettings = apps.get_model("core", "GlobalSettings")
    UserProfile = apps.get_model("core", "UserProfile")

    gs, _ = GlobalSettings.objects.get_or_create(singleton_key="global")
    if getattr(gs, "tax_identification_number", None):
        return

    row = UserProfile.objects.exclude(tax_identification_number__isnull=True).exclude(tax_identification_number="").first()
    if row is None:
        return

    gs.tax_identification_number = row.tax_identification_number
    gs.save(update_fields=["tax_identification_number"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0010_userprofile_business_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="globalsettings",
            name="tax_identification_number",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.RunPython(copy_tax_id_to_global_settings, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="userprofile",
            name="tax_identification_number",
        ),
    ]

