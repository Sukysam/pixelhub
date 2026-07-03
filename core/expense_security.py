from __future__ import annotations

import base64
import hashlib
import os
import uuid
from typing import Tuple

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.files.base import ContentFile


EXPENSE_ENCRYPTION_PREFIX = "encv1:"


def _expense_encryption_key() -> bytes:
    raw = os.environ.get("EXPENSE_DATA_ENCRYPTION_KEY")
    if raw:
        try:
            return base64.urlsafe_b64decode(raw.encode("utf-8"))
        except Exception:
            pass
    digest = hashlib.sha256(str(settings.SECRET_KEY).encode("utf-8")).digest()
    return digest


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(_expense_encryption_key())
    return Fernet(key)


def is_encrypted_expense_value(value: object) -> bool:
    return isinstance(value, str) and value.startswith(EXPENSE_ENCRYPTION_PREFIX)


def encrypt_expense_text(value: str | None) -> str | None:
    if value in (None, ""):
        return None if value is None else ""
    text = str(value)
    if is_encrypted_expense_value(text):
        return text
    token = _fernet().encrypt(text.encode("utf-8")).decode("utf-8")
    return f"{EXPENSE_ENCRYPTION_PREFIX}{token}"


def decrypt_expense_text(value: str | None) -> str | None:
    if value in (None, ""):
        return value
    text = str(value)
    if not is_encrypted_expense_value(text):
        return text
    token = text[len(EXPENSE_ENCRYPTION_PREFIX) :]
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def encrypt_uploaded_receipt(upload) -> Tuple[ContentFile, str, str | None]:
    raw = upload.read()
    upload.seek(0)
    encrypted = _fernet().encrypt(raw)
    original_name = os.path.basename(getattr(upload, "name", "") or "receipt.bin")
    content_type = getattr(upload, "content_type", None)
    ext = os.path.splitext(original_name)[1].lower() or ".bin"
    stored_name = f"{uuid.uuid4().hex}{ext}.enc"
    content = ContentFile(encrypted, name=stored_name)
    return content, original_name, content_type


def decrypt_receipt_bytes(data: bytes) -> bytes:
    return _fernet().decrypt(data)
