from __future__ import annotations

import hashlib
import io
import re
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from PIL import Image, ImageDraw, UnidentifiedImageError
from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework.exceptions import ValidationError

from .models import GlobalSettings, LogoAsset, UserSettings


LOGO_SCOPE_GLOBAL = LogoAsset.SCOPE_GLOBAL_APPEARANCE
LOGO_SCOPE_INVOICE = LogoAsset.SCOPE_INVOICE_TEMPLATE
LOGO_SCOPE_RECEIPT = LogoAsset.SCOPE_RECEIPT_TEMPLATE
LOGO_ALLOWED_SCOPES = {LOGO_SCOPE_GLOBAL, LOGO_SCOPE_INVOICE, LOGO_SCOPE_RECEIPT}
LOGO_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".svg", ".webp"}
LOGO_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/svg+xml",
    "image/svg",
    "image/webp",
}
SVG_ALLOWED_TAGS = {
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "defs",
    "lineargradient",
    "radialgradient",
    "stop",
    "clippath",
    "mask",
    "title",
    "desc",
    "text",
    "tspan",
    "symbol",
    "use",
    "style",
}
SVG_ALLOWED_ATTRS = {
    "xmlns",
    "viewbox",
    "width",
    "height",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "fill-opacity",
    "stroke-opacity",
    "opacity",
    "d",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "transform",
    "preserveaspectratio",
    "version",
    "class",
    "id",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientunits",
    "gradienttransform",
    "clip-path",
    "cliprule",
    "clip-rule",
    "fillrule",
    "fill-rule",
    "mask",
    "maskunits",
    "maskcontentunits",
    "href",
    "xlink:href",
    "style",
}
SVG_DISALLOWED_VALUE_RE = re.compile(r"javascript:|data:|vbscript:|expression\s*\(|@import|url\s*\(", re.IGNORECASE)
SVG_DISALLOWED_TEXT_RE = re.compile(r"<!doctype|<!entity|<script|<iframe|<object|<embed|<foreignobject", re.IGNORECASE)
EICAR_SIGNATURE = b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE"


@dataclass
class PreparedLogo:
    content: bytes
    thumbnail_content: bytes
    extension: str
    content_type: str
    sha256: str
    size_bytes: int
    width: int | None
    height: int | None


def _settings_max_logo_bytes() -> int:
    return int(getattr(settings, "LOGO_UPLOAD_MAX_BYTES", 5 * 1024 * 1024))


def normalize_logo_scope(raw_scope: object) -> str:
    scope = str(raw_scope or "").strip().lower()
    if scope not in LOGO_ALLOWED_SCOPES:
        raise ValidationError({"scope": "Invalid logo scope"})
    return scope


def _file_extension(name: str) -> str:
    lowered = str(name or "").strip().lower()
    if "." not in lowered:
        return ""
    return lowered.rsplit(".", 1)[-1].join([".", ""])


def _validate_file_metadata(file) -> tuple[str, str]:
    name = str(getattr(file, "name", "") or "")
    content_type = (getattr(file, "content_type", "") or "").lower()
    extension = _file_extension(name)
    if extension not in LOGO_ALLOWED_EXTENSIONS and content_type not in LOGO_ALLOWED_CONTENT_TYPES:
        raise ValidationError({"file": "Unsupported file type. Only JPG, PNG, SVG, and WebP are allowed."})
    if getattr(file, "size", 0) and int(file.size) > _settings_max_logo_bytes():
        raise ValidationError({"file": "File too large. Maximum size is 5MB."})
    return extension, content_type


def _hash_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _verify_content_integrity(raw: bytes, expected_sha256: str) -> None:
    actual = _hash_bytes(raw)
    if actual != expected_sha256:
        raise ValidationError({"file": "Stored file failed integrity verification."})


def _raise_if_eicar(raw: bytes) -> None:
    if EICAR_SIGNATURE in raw.upper():
        raise ValidationError({"file": "Malware signature detected in upload."})


def _local_tag_name(value: str) -> str:
    return value.split("}", 1)[1] if "}" in value else value


def _sanitize_svg(raw: bytes) -> PreparedLogo:
    _raise_if_eicar(raw)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationError({"file": "SVG must be valid UTF-8."}) from exc
    if SVG_DISALLOWED_TEXT_RE.search(text):
        raise ValidationError({"file": "SVG contains disallowed content."})
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValidationError({"file": "Invalid SVG file."}) from exc
    if _local_tag_name(root.tag).lower() != "svg":
        raise ValidationError({"file": "Invalid SVG root element."})

    for element in root.iter():
        tag_name = _local_tag_name(element.tag).lower()
        if tag_name not in SVG_ALLOWED_TAGS:
            raise ValidationError({"file": f"Unsupported SVG element: {tag_name}"})
        if element.text and SVG_DISALLOWED_VALUE_RE.search(element.text):
            raise ValidationError({"file": "SVG contains unsafe text content."})
        for attr_name, attr_value in list(element.attrib.items()):
            lowered_name = _local_tag_name(attr_name).lower()
            value = str(attr_value or "").strip()
            if lowered_name.startswith("on"):
                raise ValidationError({"file": "SVG event handlers are not allowed."})
            if lowered_name not in SVG_ALLOWED_ATTRS and not lowered_name.startswith("aria-"):
                raise ValidationError({"file": f"Unsupported SVG attribute: {lowered_name}"})
            if SVG_DISALLOWED_VALUE_RE.search(value):
                raise ValidationError({"file": "SVG contains unsafe attribute content."})
            if lowered_name in {"href", "xlink:href"} and value and not value.startswith("#"):
                raise ValidationError({"file": "SVG external references are not allowed."})

    sanitized = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    sha256 = _hash_bytes(sanitized)

    thumb = Image.new("RGBA", (256, 256), (255, 255, 255, 0))
    draw = ImageDraw.Draw(thumb)
    draw.rounded_rectangle((24, 24, 232, 232), radius=24, outline=(31, 41, 55, 255), fill=(248, 250, 252, 255), width=3)
    draw.text((92, 116), "SVG", fill=(31, 41, 55, 255))
    thumb_buf = io.BytesIO()
    thumb.save(thumb_buf, format="PNG", optimize=True)
    return PreparedLogo(
        content=sanitized,
        thumbnail_content=thumb_buf.getvalue(),
        extension="svg",
        content_type="image/svg+xml",
        sha256=sha256,
        size_bytes=len(sanitized),
        width=None,
        height=None,
    )


def _sanitize_raster(raw: bytes) -> PreparedLogo:
    _raise_if_eicar(raw)
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError({"file": "Invalid image file."}) from exc

    detected = str(getattr(img, "format", "") or "").upper()
    if detected not in {"PNG", "JPEG", "WEBP"}:
        raise ValidationError({"file": "Unsupported file type. Only JPG, PNG, SVG, and WebP are allowed."})

    width, height = img.size
    if max(width, height) > 1024:
        img.thumbnail((1024, 1024))
        width, height = img.size

    if detected == "PNG":
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        extension = "png"
        content_type = "image/png"
        save_kwargs = {"format": "PNG", "optimize": True}
    elif detected == "WEBP":
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        extension = "webp"
        content_type = "image/webp"
        save_kwargs = {"format": "WEBP", "quality": 90, "method": 6}
    else:
        if img.mode != "RGB":
            img = img.convert("RGB")
        extension = "jpg"
        content_type = "image/jpeg"
        save_kwargs = {"format": "JPEG", "quality": 88, "optimize": True, "progressive": True}

    content_buf = io.BytesIO()
    img.save(content_buf, **save_kwargs)
    content = content_buf.getvalue()

    thumb = img.copy()
    thumb.thumbnail((256, 256))
    if thumb.mode not in ("RGB", "RGBA"):
        thumb = thumb.convert("RGBA")
    thumb_buf = io.BytesIO()
    thumb.save(thumb_buf, format="PNG", optimize=True)
    return PreparedLogo(
        content=content,
        thumbnail_content=thumb_buf.getvalue(),
        extension=extension,
        content_type=content_type,
        sha256=_hash_bytes(content),
        size_bytes=len(content),
        width=width,
        height=height,
    )


def prepare_logo_upload(file) -> PreparedLogo:
    extension, content_type = _validate_file_metadata(file)
    raw = file.read()
    if not raw:
        raise ValidationError({"file": "File is empty."})
    if len(raw) > _settings_max_logo_bytes():
        raise ValidationError({"file": "File too large. Maximum size is 5MB."})
    if extension == ".svg" or content_type in {"image/svg+xml", "image/svg"}:
        return _sanitize_svg(raw)
    return _sanitize_raster(raw)


def create_logo_asset(file, *, scope: str, owner=None) -> LogoAsset:
    prepared = prepare_logo_upload(file)
    token = uuid.uuid4().hex
    asset = LogoAsset(
        scope=scope,
        owner=owner,
        original_name=str(getattr(file, "name", "") or f"{token}.{prepared.extension}"),
        content_type=prepared.content_type,
        sha256=prepared.sha256,
        size_bytes=prepared.size_bytes,
        width=prepared.width,
        height=prepared.height,
    )
    asset.file.save(f"{scope}_{token}.{prepared.extension}", ContentFile(prepared.content), save=False)
    asset.thumbnail.save(f"{scope}_{token}_thumb.png", ContentFile(prepared.thumbnail_content), save=False)
    asset.save()

    with asset.file.storage.open(asset.file.name, "rb") as fh:
        _verify_content_integrity(fh.read(), prepared.sha256)
    return asset


def cleanup_logo_asset_if_unreferenced(asset: LogoAsset | None) -> None:
    if asset is None or not getattr(asset, "pk", None):
        return
    if GlobalSettings.objects.filter(appearance_logo_id=asset.pk).exists():
        return
    if UserSettings.objects.filter(invoice_logo_id=asset.pk).exists():
        return
    if UserSettings.objects.filter(receipt_logo_id=asset.pk).exists():
        return
    if asset.file:
        asset.file.delete(save=False)
    if asset.thumbnail:
        asset.thumbnail.delete(save=False)
    asset.delete()

