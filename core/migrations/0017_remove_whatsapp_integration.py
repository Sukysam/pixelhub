from django.db import migrations


def forwards(apps, schema_editor):
    DocumentDelivery = apps.get_model("core", "DocumentDelivery")
    DocumentDelivery.objects.filter(channel="whatsapp").update(channel="share")


def backwards(apps, schema_editor):
    DocumentDelivery = apps.get_model("core", "DocumentDelivery")
    DocumentDelivery.objects.filter(channel="share").update(channel="whatsapp")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0016_whatsapp_preferences"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
        migrations.RemoveField(
            model_name="documentdelivery",
            name="whatsapp_integration",
        ),
        migrations.DeleteModel(
            name="WhatsAppMessagingPreference",
        ),
        migrations.DeleteModel(
            name="WhatsAppTemplate",
        ),
        migrations.DeleteModel(
            name="WhatsAppIntegration",
        ),
    ]

