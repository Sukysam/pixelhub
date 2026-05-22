from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from datetime import timedelta
from typing import Optional

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import AccessToken, AdminMfaDevice, Role, UserRole


def _generate_token_key() -> str:
    return secrets.token_urlsafe(48)[:64]


def issue_access_token(*, user, role: Role, expires_seconds: Optional[int] = None) -> AccessToken:
    now = timezone.now()
    expires_at = None
    if expires_seconds is not None:
        expires_at = now + timedelta(seconds=int(expires_seconds))
    for _ in range(5):
        key = _generate_token_key()
        try:
            return AccessToken.objects.create(user=user, role=role, key=key, expires_at=expires_at)
        except Exception:
            continue
    raise ValidationError({"detail": "Unable to issue token. Please try again."})


def revoke_token(token_row: AccessToken) -> None:
    if token_row is None:
        return
    if token_row.revoked_at is not None:
        return
    token_row.revoked_at = timezone.now()
    token_row.save(update_fields=["revoked_at"])


def role_for_name(name: str) -> Role:
    role = Role.objects.filter(name=str(name or "").strip()).first()
    if role is None:
        raise ValidationError({"detail": "Role not configured"})
    return role


def user_has_role_name(user, role_name: str) -> bool:
    return UserRole.objects.filter(user=user, role__name=str(role_name)).exists()


def ensure_user_role(user, role_name: str) -> None:
    role = Role.objects.filter(name=str(role_name)).first()
    if role is None:
        return
    UserRole.objects.get_or_create(user=user, role=role)


def _base32_secret() -> str:
    raw = secrets.token_bytes(20)
    return base64.b32encode(raw).decode("utf-8").replace("=", "")


def totp_now(secret_b32: str, *, step_seconds: int = 30, digits: int = 6, for_ts: Optional[int] = None) -> str:
    ts = int(for_ts if for_ts is not None else time.time())
    counter = ts // int(step_seconds)
    padding = "=" * ((8 - (len(secret_b32) % 8)) % 8)
    key = base64.b32decode((secret_b32 + padding).upper().encode("utf-8"))
    msg = counter.to_bytes(8, "big")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    code = code_int % (10**digits)
    return str(code).zfill(digits)


def totp_verify(secret_b32: str, code: str, *, step_seconds: int = 30, digits: int = 6, window: int = 1) -> bool:
    c = str(code or "").strip()
    if len(c) != digits or not c.isdigit():
        return False
    now = int(time.time())
    for w in range(-window, window + 1):
        ts = now + w * step_seconds
        if totp_now(secret_b32, step_seconds=step_seconds, digits=digits, for_ts=ts) == c:
            return True
    return False


def admin_mfa_setup(user, *, force_reset: bool = False, allow_reset: bool = False) -> dict:
    device = AdminMfaDevice.objects.filter(user=user).first()
    if device is None:
        device = AdminMfaDevice.objects.create(user=user, secret=_base32_secret())
    if device.confirmed_at is not None:
        if force_reset and allow_reset:
            device.secret = _base32_secret()
            device.confirmed_at = None
            device.last_used_ts = None
            device.save(update_fields=["secret", "confirmed_at", "last_used_ts", "updated_at"])
        else:
            raise ValidationError({"detail": "MFA is already enabled"})

    issuer = "PIXELHUB"
    label = f"{issuer}:{getattr(user, 'username', '')}"
    uri = f"otpauth://totp/{label}?secret={device.secret}&issuer={issuer}&digits=6&period=30"
    return {"secret": device.secret, "provisioning_uri": uri}


@transaction.atomic
def admin_mfa_confirm(user, code: str) -> None:
    device = AdminMfaDevice.objects.select_for_update().filter(user=user).first()
    if device is None:
        raise ValidationError({"detail": "MFA is not set up"})
    if device.confirmed_at is not None:
        return
    if not totp_verify(device.secret, code, window=2):
        raise ValidationError({"code": "Invalid code"})
    device.confirmed_at = timezone.now()
    device.last_used_ts = int(time.time())
    device.save(update_fields=["confirmed_at", "last_used_ts", "updated_at"])


@transaction.atomic
def admin_mfa_assert(user, code: str) -> None:
    device = AdminMfaDevice.objects.select_for_update().filter(user=user).first()
    if device is None or device.confirmed_at is None:
        raise ValidationError({"detail": "Admin MFA is required. Please set it up first."})
    now = int(time.time())
    if not totp_verify(device.secret, code, window=2):
        raise ValidationError({"code": "Invalid code"})
    last = int(device.last_used_ts) if device.last_used_ts is not None else None
    if last is not None and abs(now - last) < 25:
        raise ValidationError({"code": "Code already used. Please wait for the next code."})
    device.last_used_ts = now
    device.save(update_fields=["last_used_ts", "updated_at"])


def authenticate_user(username: str, password: str):
    User = get_user_model()
    u = User.objects.filter(username=username).first()
    if u is None:
        return None
    if not u.check_password(password):
        return None
    if not bool(getattr(u, "is_active", True)):
        return None
    return u
