from django.db import migrations, models


def purge_expense_receipt_files(apps, schema_editor):
    Expense = apps.get_model("core", "Expense")
    for expense in Expense.objects.exclude(receipt_file="").exclude(receipt_file__isnull=True).iterator(chunk_size=200):
        receipt = getattr(expense, "receipt_file", None)
        if not receipt:
            continue
        try:
            storage = receipt.storage
            name = receipt.name
            if name and storage.exists(name):
                storage.delete(name)
        except Exception:
            pass


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0030_customer_internal_remarks"),
    ]

    operations = [
        migrations.AddField(
            model_name="expense",
            name="source_account",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddIndex(
            model_name="expense",
            index=models.Index(fields=["is_deleted", "source_account"], name="core_expens_is_dele_source_idx"),
        ),
        migrations.RunPython(purge_expense_receipt_files, migrations.RunPython.noop),
        migrations.RemoveIndex(model_name="expense", name="core_expens_is_dele_848c01_idx"),
        migrations.RemoveIndex(model_name="expense", name="core_expens_is_dele_14abe1_idx"),
        migrations.RemoveField(model_name="expense", name="approval_status"),
        migrations.RemoveField(model_name="expense", name="approved_at"),
        migrations.RemoveField(model_name="expense", name="approved_by"),
        migrations.RemoveField(model_name="expense", name="policy_notes"),
        migrations.RemoveField(model_name="expense", name="policy_status"),
        migrations.RemoveField(model_name="expense", name="receipt_content_type"),
        migrations.RemoveField(model_name="expense", name="receipt_file"),
        migrations.RemoveField(model_name="expense", name="receipt_original_name"),
    ]

