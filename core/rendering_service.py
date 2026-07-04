from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from .models import Currency, GlobalSettings, LogoAsset, UserProfile, UserSettings


COUNTRY_CONFIG = {
    "US": {
        "currency": "USD",
        "formats": {"date_format": "MM/DD/YYYY", "number_format": "1,234.56"},
        "tax": {"type": "sales_tax", "default_rate": "0", "inclusive": False},
        "compliance": {"invoice_requires_tax_id": False},
    },
    "GB": {
        "currency": "GBP",
        "formats": {"date_format": "DD/MM/YYYY", "number_format": "1,234.56"},
        "tax": {"type": "vat", "default_rate": "20", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": True},
    },
    "DE": {
        "currency": "EUR",
        "formats": {"date_format": "DD.MM.YYYY", "number_format": "1.234,56"},
        "tax": {"type": "vat", "default_rate": "19", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": True},
    },
    "FR": {
        "currency": "EUR",
        "formats": {"date_format": "DD/MM/YYYY", "number_format": "1 234,56"},
        "tax": {"type": "vat", "default_rate": "20", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": True},
    },
    "JP": {
        "currency": "JPY",
        "formats": {"date_format": "YYYY/MM/DD", "number_format": "1,234"},
        "tax": {"type": "consumption_tax", "default_rate": "10", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": False},
    },
    "CA": {
        "currency": "CAD",
        "formats": {"date_format": "YYYY-MM-DD", "number_format": "1,234.56"},
        "tax": {"type": "gst", "default_rate": "5", "inclusive": False},
        "compliance": {"invoice_requires_tax_id": True},
    },
    "AU": {
        "currency": "AUD",
        "formats": {"date_format": "DD/MM/YYYY", "number_format": "1,234.56"},
        "tax": {"type": "gst", "default_rate": "10", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": True},
    },
    "NG": {
        "currency": "NGN",
        "formats": {"date_format": "DD/MM/YYYY", "number_format": "1,234.56"},
        "tax": {"type": "vat", "default_rate": "7.5", "inclusive": True},
        "compliance": {"invoice_requires_tax_id": True},
    },
}


def get_global_settings() -> GlobalSettings:
    obj, _ = GlobalSettings.objects.get_or_create(singleton_key="global")
    if obj.default_currency_id is None:
        ngn, _ = Currency.objects.get_or_create(
            code="NGN",
            defaults={"name": "Nigerian Naira", "symbol": "₦", "decimal_places": 2},
        )
        obj.default_currency = ngn
        obj.save(update_fields=["default_currency", "updated_at"])
    return obj


def get_user_settings(user) -> UserSettings:
    obj, _ = UserSettings.objects.get_or_create(user=user)
    return obj


def logo_urls_for_asset(asset: Optional[LogoAsset]) -> dict[str, Optional[str]]:
    if asset is None:
        return {"logo_url": None, "logo_thumbnail_url": None}
    return {
        "logo_url": asset.file_url,
        "logo_thumbnail_url": asset.thumbnail_url,
    }


def effective_logo_assets_for_user(user) -> dict[str, Optional[LogoAsset]]:
    gs = get_global_settings()
    global_logo = getattr(gs, "appearance_logo", None)
    invoice_logo = None
    receipt_logo = None
    if getattr(user, "is_authenticated", False) and gs.allow_user_overrides:
        us = get_user_settings(user)
        invoice_logo = getattr(us, "invoice_logo", None)
        receipt_logo = getattr(us, "receipt_logo", None)
    return {
        "global_appearance": global_logo,
        "invoice_template": invoice_logo,
        "receipt_template": receipt_logo,
    }


def effective_company_identity_for_user(user) -> dict[str, Optional[str]]:
    gs = get_global_settings()
    appearance = gs.appearance or {}
    profile_company = None
    if getattr(user, "is_authenticated", False):
        profile = UserProfile.objects.filter(user=user).only("company_legal_name").first()
        profile_company = getattr(profile, "company_legal_name", None) if profile else None
    company_name = str(appearance.get("company_name") or "").strip() or str(profile_company or "").strip() or "PIXELHUB"
    company_tagline = str(appearance.get("company_tagline") or "").strip() or None
    return {"company_name": company_name, "company_tagline": company_tagline}


def effective_templates_for_user(user) -> dict:
    gs = get_global_settings()
    global_appearance = gs.appearance or {}
    invoice_template = {}
    receipt_template = {}
    global_logo = getattr(gs, "appearance_logo", None)
    invoice_logo = None
    receipt_logo = None
    identity = effective_company_identity_for_user(user)
    if getattr(user, "is_authenticated", False):
        us = get_user_settings(user)
        if gs.allow_user_overrides:
            invoice_template = us.invoice_template or {}
            receipt_template = us.receipt_template or {}
            invoice_logo = getattr(us, "invoice_logo", None)
            receipt_logo = getattr(us, "receipt_logo", None)

    invoice_template = {
        "primary_color": None,
        "font_family": None,
        "logo_url": None,
        "logo_thumbnail_url": None,
        "footer_text": None,
        "layout": "classic",
        "show_item_description": False,
        "currency_symbol_position": None,
        **(invoice_template if isinstance(invoice_template, dict) else {}),
    }
    receipt_template = {
        "primary_color": None,
        "font_family": None,
        "logo_url": None,
        "logo_thumbnail_url": None,
        "header_text": None,
        "footer_text": None,
        "numbering_format": None,
        "layout": "classic",
        "show_items": True,
        "show_item_description": False,
        "currency_symbol_position": None,
        **(receipt_template if isinstance(receipt_template, dict) else {}),
    }
    global_appearance = {
        "primary_color": None,
        "font_family": None,
        "logo_url": None,
        "logo_thumbnail_url": None,
        "company_name": identity["company_name"],
        "company_tagline": identity["company_tagline"],
        "invoice_footer_text": None,
        "receipt_footer_text": None,
        **(global_appearance if isinstance(global_appearance, dict) else {}),
    }
    global_appearance.update(logo_urls_for_asset(global_logo))
    if invoice_logo is not None:
        invoice_template.update(logo_urls_for_asset(invoice_logo))
    if receipt_logo is not None:
        receipt_template.update(logo_urls_for_asset(receipt_logo))
    return {
        "global_appearance": global_appearance,
        "invoice_template": invoice_template,
        "receipt_template": receipt_template,
    }


def country_config(country_code: Optional[str]) -> Optional[dict]:
    if not country_code:
        return None
    return COUNTRY_CONFIG.get(str(country_code).upper())


def detect_country(request) -> Optional[str]:
    explicit = request.query_params.get("country")
    if explicit:
        cc = str(explicit).upper()
        if re.fullmatch(r"[A-Z]{2}", cc):
            return cc

    for header in ("CF-IPCountry", "X-Country-Code", "X-Country"):
        value = request.headers.get(header)
        if value:
            cc = str(value).upper()
            if re.fullmatch(r"[A-Z]{2}", cc):
                return cc

    accept = (request.headers.get("accept-language") or "").lower()
    if accept.startswith("en-gb"):
        return "GB"
    if accept.startswith("de"):
        return "DE"
    if accept.startswith("fr"):
        return "FR"
    if accept.startswith("ja"):
        return "JP"
    if accept.startswith("en-au"):
        return "AU"
    if accept.startswith("en-ca"):
        return "CA"
    if accept.startswith("en-us"):
        return "US"
    return None


def effective_region_settings_for_user(request, user, *, detect_country) -> dict:
    gs = get_global_settings()
    global_currency_code = gs.default_currency.code if gs.default_currency_id else None
    global_tax = gs.tax_configuration or {}

    country = None
    language = None
    date_format = None
    number_format = None
    currency_code = None

    if getattr(user, "is_authenticated", False):
        us = get_user_settings(user)
        country = us.country or None
        language = us.language or None
        date_format = us.date_format or None
        number_format = us.number_format or None
        if gs.allow_user_overrides:
            currency_code = us.currency.code if us.currency_id else None

    if not country:
        country = detect_country(request)
    cfg = country_config(country)

    if not currency_code:
        currency_code = global_currency_code or (cfg or {}).get("currency") or "NGN"
    if not date_format:
        date_format = ((cfg or {}).get("formats") or {}).get("date_format") or "YYYY-MM-DD"
    if not number_format:
        number_format = ((cfg or {}).get("formats") or {}).get("number_format") or "1,234.56"
    if not language:
        language = "en"

    tax_defaults = (cfg or {}).get("tax") or {}
    merged_tax = {**tax_defaults, **global_tax}
    return {
        "country": country,
        "language": language,
        "date_format": date_format,
        "number_format": number_format,
        "currency_code": currency_code,
        "tax": merged_tax,
        "compliance": (cfg or {}).get("compliance") or {},
    }


def currency_for_code(code: str) -> Optional[Currency]:
    code_u = (code or "").upper()
    if not code_u:
        return None
    try:
        return Currency.objects.get(code=code_u)
    except Currency.DoesNotExist:
        return None


def number_separators_for_format(number_format: str) -> tuple[str, str]:
    s = number_format or "1,234.56"
    thousands = ","
    decimal = "."
    if "1.234,56" in s:
        thousands = "."
        decimal = ","
    elif "1 234,56" in s:
        thousands = " "
        decimal = ","
    elif "1,234" in s and "56" not in s:
        decimal = ""
    elif "1.234" in s and "56" not in s:
        thousands = "."
        decimal = ""
    return thousands, decimal


def quantize_to_decimals(value: Decimal, decimals: int) -> Decimal:
    if decimals <= 0:
        return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    q = Decimal("1").scaleb(-decimals)
    return value.quantize(q, rounding=ROUND_HALF_UP)


def format_number(value: Decimal, number_format: str, decimals: int) -> str:
    thousands_sep, decimal_sep = number_separators_for_format(number_format)
    q = quantize_to_decimals(value, decimals)
    sign = "-" if q < 0 else ""
    q_abs = abs(q)
    s = f"{q_abs:f}"
    if "." in s:
        int_part, frac_part = s.split(".", 1)
    else:
        int_part, frac_part = s, ""
    if decimals <= 0:
        frac_part = ""
    else:
        frac_part = frac_part[:decimals].ljust(decimals, "0")

    chunks = []
    while int_part:
        chunks.append(int_part[-3:])
        int_part = int_part[:-3]
    int_formatted = thousands_sep.join(reversed(chunks)) if chunks else "0"
    if decimals <= 0 or decimal_sep == "":
        return f"{sign}{int_formatted}"
    return f"{sign}{int_formatted}{decimal_sep}{frac_part}"


def format_money(
    value: Decimal,
    currency: Optional[Currency],
    number_format: str,
    symbol_position: str = "prefix",
) -> str:
    if currency is None:
        currency = currency_for_code("USD")
    decimals = int(getattr(currency, "decimal_places", 2) or 2)
    symbol = getattr(currency, "symbol", None) or getattr(currency, "code", "")
    formatted = format_number(value, number_format, decimals)
    if symbol_position == "suffix":
        return f"{formatted} {symbol}".strip()
    return f"{symbol}{formatted}"


def format_date_for_pattern(value: date, date_format: str) -> str:
    fmt = (date_format or "YYYY-MM-DD").upper()
    if fmt == "MM/DD/YYYY":
        return value.strftime("%m/%d/%Y")
    if fmt == "DD/MM/YYYY":
        return value.strftime("%d/%m/%Y")
    if fmt == "DD.MM.YYYY":
        return value.strftime("%d.%m.%Y")
    if fmt == "YYYY/MM/DD":
        return value.strftime("%Y/%m/%d")
    return value.strftime("%Y-%m-%d")
