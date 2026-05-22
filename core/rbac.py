from __future__ import annotations

from typing import Iterable

from django.contrib.auth import get_user_model
from django.db.models import Exists, OuterRef

from .models import Permission, Role, RolePermission, UserRole


def user_role_names(user) -> list[str]:
    if not getattr(user, "is_authenticated", False):
        return []
    return list(
        UserRole.objects.filter(user=user)
        .select_related("role")
        .values_list("role__name", flat=True)
    )


def user_has_role(user, role_name: str) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    return UserRole.objects.filter(user=user, role__name=role_name).exists()


def user_has_any_role(user, role_names: Iterable[str]) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    names = [str(x) for x in role_names if str(x)]
    if not names:
        return False
    return UserRole.objects.filter(user=user, role__name__in=names).exists()


def user_has_permission(user, permission_code: str) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    code = str(permission_code or "").strip()
    if not code:
        return False
    perm = Permission.objects.filter(code=code).only("id").first()
    if perm is None:
        return False
    rp = RolePermission.objects.filter(permission_id=perm.id, role_id=OuterRef("role_id"))
    return UserRole.objects.filter(user=user).annotate(has=Exists(rp)).filter(has=True).exists()


def sync_user_role_from_flags(user) -> None:
    if user is None:
        return
    if not getattr(user, "pk", None):
        return
    User = get_user_model()
    if not isinstance(user, User):
        return

    role_name = "user"
    if bool(getattr(user, "is_superuser", False)):
        role_name = "admin"
    elif bool(getattr(user, "is_staff", False)):
        role_name = "staff"

    UserRole.objects.filter(user=user).exclude(role__name=role_name).delete()
    role = Role.objects.filter(name=role_name).first()
    if role is None:
        return
    UserRole.objects.get_or_create(user=user, role=role)
