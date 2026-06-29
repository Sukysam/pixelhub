from __future__ import annotations

import hashlib
import os
from urllib.parse import urlparse

from django.conf import settings
from django.db import migrations, models


ZERO_SHA256 = "0" * 64


def _relative_media_path(raw_url: object) -> str | None:
    value = str(raw_url or "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    path = parsed.path or value
    marker = "/media/"
    if marker not in path:
        return None
    rel = path.split(marker, 1)[1].lstrip("/")
    if not rel.startswith("uploads/logos/"):
        return None
    return rel


def _guess_content_type(path: str | None) -> str:
    lowered = str(path or "").lower()
    if lowered.endswith(".png"):
        return "image/png"
    if lowered.endswith(".webp"):
        return "image/webp"
    if lowered.endswith(".svg"):
        return "image/svg+xml"
    return "image/jpeg"


def _file_metadata(relative_path: str | None) -> tuple[str, int, int | None, int | None]:
    if not relative_path:
        return (ZERO_SHA256, 0, None, None)
    media_root = str(getattr(settings, "MEDIA_ROOT", "") or "")
    if not media_root:
        return (ZERO_SHA256, 0, None, None)
    abs_path = os.path.join(media_root, relative_path)
    if not os.path.exists(abs_path):
        return (ZERO_SHA256, 0, None, None)
    digest = hashlib.sha256()
    with open(abs_path, "rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    size_bytes = os.path.getsize(abs_path)
    width = None
    height = None
    try:
        from PIL import Image

        with Image.open(abs_path) as img:
            width, height = img.size
    except Exception:
        width = None
        height = None
    return (digest.hexdigest(), size_bytes, width, height)


def _migrate_logo_url_to_asset(row, *, scope: str, logo_field: str, thumb_field: str, logo_asset_model):
    settings_dict = getattr(row, logo_field, None) or {}
    if not isinstance(settings_dict, dict):
        return None
    logo_path = _relative_media_path(settings_dict.get("logo_url"))
    if not logo_path:
        return None
    thumb_path = _relative_media_path(settings_dict.get("logo_thumbnail_url"))
    sha256, size_bytes, width, height = _file_metadata(logo_path)
    asset = logo_asset_model.objects.create(
        scope=scope,
        owner_id=getattr(row, "user_id", None),
        original_name=os.path.basename(logo_path),
        file=logo_path,
        thumbnail=thumb_path or "",
        content_type=_guess_content_type(logo_path),
        sha256=sha256,
        size_bytes=size_bytes,
        width=width,
        height=height,
    )
    return asset.id


def forwards(apps, schema_editor):
    GlobalSettings = apps.get_model("core", "GlobalSettings")
    UserSettings = apps.get_model("core", "UserSettings")
    LogoAsset = apps.get_model("core", "LogoAsset")

    for row in GlobalSettings.objects.all():
        appearance = row.appearance or {}
        if not isinstance(appearance, dict):
            continue
        logo_path = _relative_media_path(appearance.get("logo_url"))
        if not logo_path:
            continue
        thumb_path = _relative_media_path(appearance.get("logo_thumbnail_url"))
        sha256, size_bytes, width, height = _file_metadata(logo_path)
        asset = LogoAsset.objects.create(
            scope="global_appearance",
            owner_id=None,
            original_name=os.path.basename(logo_path),
            file=logo_path,
            thumbnail=thumb_path or "",
            content_type=_guess_content_type(logo_path),
            sha256=sha256,
            size_bytes=size_bytes,
            width=width,
            height=height,
        )
        row.appearance_logo_id = asset.id
        row.save(update_fields=["appearance_logo"])

    for row in UserSettings.objects.all():
        invoice_asset_id = _migrate_logo_url_to_asset(
            row,
            scope="invoice_template",
            logo_field="invoice_template",
            thumb_field="logo_thumbnail_url",
            logo_asset_model=LogoAsset,
        )
        receipt_asset_id = _migrate_logo_url_to_asset(
            row,
            scope="receipt_template",
            logo_field="receipt_template",
            thumb_field="logo_thumbnail_url",
            logo_asset_model=LogoAsset,
        )
        changed = []
        if invoice_asset_id:
            row.invoice_logo_id = invoice_asset_id
            changed.append("invoice_logo")
        if receipt_asset_id:
            row.receipt_logo_id = receipt_asset_id
            changed.append("receipt_logo")
        if changed:
            row.save(update_fields=changed)


def backwards(apps, schema_editor):
    GlobalSettings = apps.get_model("core", "GlobalSettings")
    UserSettings = apps.get_model("core", "UserSettings")
    GlobalSettings.objects.update(appearance_logo=None)
    UserSettings.objects.update(invoice_logo=None, receipt_logo=None)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0021_seed_management_roles"),
    ]

    operations = [
        migrations.CreateModel(
            name="LogoAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scope", models.CharField(choices=[("global_appearance", "Global appearance"), ("invoice_template", "Invoice template"), ("receipt_template", "Receipt template")], max_length=40)),
                ("original_name", models.CharField(max_length=255)),
                ("file", models.FileField(upload_to="uploads/logos/")),
                ("thumbnail", models.FileField(blank=True, null=True, upload_to="uploads/logos/")),
                ("content_type", models.CharField(max_length=100)),
                ("sha256", models.CharField(max_length=64)),
                ("size_bytes", models.PositiveIntegerField(default=0)),
                ("width", models.PositiveIntegerField(blank=True, null=True)),
                ("height", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddField(
            model_name="globalsettings",
            name="appearance_logo",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="+", to="core.logoasset"),
        ),
        migrations.AddField(
            model_name="usersettings",
            name="invoice_logo",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="+", to="core.logoasset"),
        ),
        migrations.AddField(
            model_name="usersettings",
            name="receipt_logo",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="+", to="core.logoasset"),
        ),
        migrations.RunPython(forwards, backwards),
    ]
