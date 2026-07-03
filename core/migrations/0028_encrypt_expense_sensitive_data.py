from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import uuid

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.files.base import ContentFile
from django.db import migrations, models


EXPENSE_ENCRYPTION_PREFIX = "encv1:"


def _expense_encryption_key() -> bytes:
    raw = os.environ.get("EXPENSE_DATA_ENCRYPTION_KEY")
    if raw:
        try:
            return base64.urlsafe_b64decode(raw.encode("utf-8"))
        except Exception:
            pass
    return hashlib.sha256(str(settings.SECRET_KEY).encode("utf-8")).digest()


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(_expense_encryption_key()))


def _is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(EXPENSE_ENCRYPTION_PREFIX)


def _encrypt_text(value):
    if value in (None, ""):
        return value
    text = str(value)
    if _is_encrypted(text):
        return text
    token = _fernet().encrypt(text.encode("utf-8")).decode("utf-8")
    return f"{EXPENSE_ENCRYPTION_PREFIX}{token}"


def _encrypt_existing_expenses(apps, schema_editor):
    Expense = apps.get_model("core", "Expense")

    for expense in Expense.objects.all().iterator(chunk_size=200):
        update_fields = []

        for field_name in ("description", "merchant_reference", "policy_notes"):
            current_value = getattr(expense, field_name, None)
            encrypted_value = _encrypt_text(current_value)
            if encrypted_value != current_value:
                setattr(expense, field_name, encrypted_value)
                update_fields.append(field_name)

        receipt_field = getattr(expense, "receipt_file", None)
        receipt_name = getattr(receipt_field, "name", "") or ""
        if receipt_name:
            original_name = getattr(expense, "receipt_original_name", None) or os.path.basename(receipt_name).removesuffix(".enc")
            content_type = getattr(expense, "receipt_content_type", None) or mimetypes.guess_type(original_name)[0]

            if getattr(expense, "receipt_original_name", None) != original_name:
                expense.receipt_original_name = original_name
                update_fields.append("receipt_original_name")
            if getattr(expense, "receipt_content_type", None) != content_type:
                expense.receipt_content_type = content_type
                update_fields.append("receipt_content_type")

            if not receipt_name.endswith(".enc"):
                storage = receipt_field.storage
                old_name = receipt_name
                if storage.exists(old_name):
                    with storage.open(old_name, "rb") as stored_file:
                        encrypted_bytes = _fernet().encrypt(stored_file.read())
                    ext = os.path.splitext(original_name)[1].lower() or ".bin"
                    expense.receipt_file.save(f"{uuid.uuid4().hex}{ext}.enc", ContentFile(encrypted_bytes), save=False)
                    update_fields.append("receipt_file")
                    if old_name != expense.receipt_file.name and storage.exists(old_name):
                        storage.delete(old_name)

        if update_fields:
            expense.save(update_fields=sorted(set(update_fields)))


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0027_expense_approval_status_expense_approved_at_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="expense",
            name="receipt_content_type",
            field=models.CharField(blank=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="expense",
            name="receipt_original_name",
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AlterField(
            model_name="expense",
            name="merchant_reference",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.RunPython(_encrypt_existing_expenses, migrations.RunPython.noop),
    ]
