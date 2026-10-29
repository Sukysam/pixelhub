"""
URL configuration for pixelhub project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import re
from pathlib import Path

from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponse, JsonResponse
from django.urls import path, include, re_path
from django.views.static import serve

_media_url_prefix = str(settings.MEDIA_URL or "/media/").lstrip("/")
if _media_url_prefix and not _media_url_prefix.endswith("/"):
    _media_url_prefix += "/"
_logo_media_pattern = rf"^{re.escape(_media_url_prefix)}uploads/logos/(?P<path>.*)$"
_logo_media_root = str(Path(settings.MEDIA_ROOT) / "uploads" / "logos")

urlpatterns = [
    path("", lambda request: JsonResponse({"service": "pixelhub", "status": "ok"}), name="root"),
    path("favicon.ico", lambda request: HttpResponse(status=204), name="favicon"),
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
    path('api/health/', lambda request: JsonResponse({'status': 'ok'})),
    # Serve uploaded logo assets in all environments so settings previews and
    # printable invoice/receipt documents can load their media in production.
    re_path(_logo_media_pattern, serve, {"document_root": _logo_media_root}),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
