from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0035_sourceaccountdeposit"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="note",
            field=models.TextField(blank=True, null=True),
        ),
    ]
