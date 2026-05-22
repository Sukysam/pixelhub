from django.db import migrations


def add_ngn(apps, schema_editor):
    Currency = apps.get_model("core", "Currency")
    Currency.objects.update_or_create(
        code="NGN",
        defaults={"name": "Nigerian Naira", "symbol": "₦", "decimal_places": 2},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_alter_auditlog_action_userprofile_and_more"),
    ]

    operations = [
        migrations.RunPython(add_ngn, migrations.RunPython.noop),
    ]

