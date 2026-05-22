from __future__ import annotations

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

from .rbac import user_has_any_role, user_has_permission


class HasRole(permissions.BasePermission):
    def __init__(self, *roles: str):
        self.roles = [str(r) for r in roles if str(r)]

    def has_permission(self, request, view):
        return user_has_any_role(request.user, self.roles)


class HasPermission(permissions.BasePermission):
    def __init__(self, *permission_codes: str):
        self.permission_codes = [str(c) for c in permission_codes if str(c)]

    def has_permission(self, request, view):
        for code in self.permission_codes:
            if user_has_permission(request.user, code):
                return True
        return False


class AdminWritePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return user_has_permission(request.user, "settings.global.read") or user_has_permission(request.user, "fx.read") or user_has_permission(request.user, "admin.users.read")
        return user_has_permission(request.user, "settings.global.write")


def require_permission(request, code: str):
    if not user_has_permission(request.user, code):
        raise PermissionDenied("You do not have permission to perform this action.")

