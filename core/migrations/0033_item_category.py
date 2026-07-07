from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0032_sourceaccount_model_and_expense_fk"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="category",
            field=models.CharField(default="General", max_length=255),
        ),
        migrations.AddIndex(
            model_name="item",
            index=models.Index(fields=["is_deleted", "category"], name="core_item_is_dele_c1d8b5_idx"),
        ),
    ]
