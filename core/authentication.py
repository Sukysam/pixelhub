from __future__ import annotations

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .models import AccessToken


class AccessTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        raw = get_authorization_header(request).decode("utf-8")
        if not raw:
            return None
        parts = raw.split()
        if len(parts) != 2:
            return None
        scheme, token = parts[0], parts[1]
        if scheme.lower() != "token":
            return None

        row = AccessToken.objects.select_related("user", "role").filter(key=token).first()
        if row is None:
            raise AuthenticationFailed("Invalid token")
        if row.revoked_at is not None:
            raise AuthenticationFailed("Token revoked")
        if row.expires_at is not None and row.expires_at <= timezone.now():
            raise AuthenticationFailed("Token expired")
        return (row.user, row)


class CookieAccessTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        token = request.COOKIES.get("auth_token")
        if not token:
            return None
        row = AccessToken.objects.select_related("user", "role").filter(key=token).first()
        if row is None:
            raise AuthenticationFailed("Invalid token")
        if row.revoked_at is not None:
            raise AuthenticationFailed("Token revoked")
        if row.expires_at is not None and row.expires_at <= timezone.now():
            raise AuthenticationFailed("Token expired")
        return (row.user, row)
