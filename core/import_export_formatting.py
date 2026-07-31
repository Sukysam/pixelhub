from __future__ import annotations

import locale
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

try:
    locale.setlocale(locale.LC_ALL, "")
except Exception:
    locale.setlocale(locale.LC_ALL, "C")

DEFAULT_DECIMAL_PLACES = 2
DEFAULT_TAX_DECIMAL_PLACES = 2
DEFAULT_QUANTITY_DECIMAL_PLACES = 0
MIN_CURRENCY_SCALE = 2
_CENTS = Decimal("0.01")
_TAX_QUANTUM = Decimal("0.01")
_CURRENCY_SYMBOL_CACHE: dict[str, str] = {}


def register_currency_symbols(mapping: dict[str, str]) -> None:
    for code, symbol in (mapping or {}).items():
        code_value = str(code or "").strip().upper()
        if not code_value:
            continue
        _CURRENCY_SYMBOL_CACHE[code_value] = str(symbol or "")


def _symbol_for(currency_code: Any) -> str:
    code_value = str(currency_code or "").strip().upper()
    if not code_value:
        return ""
    if code_value in _CURRENCY_SYMBOL_CACHE:
        return _CURRENCY_SYMBOL_CACHE[code_value]
    try:
        import locale as _locale

        mapping = {
            "AUD": "A$",
            "BRL": "R$",
            "CAD": "C$",
            "CHF": "CHF ",
            "CNY": "¥",
            "EUR": "€",
            "GBP": "£",
            "JPY": "¥",
            "KES": "KSh ",
            "NGN": "₦",
            "USD": "$",
            "ZAR": "R",
        }
        symbol = mapping.get(code_value, "")
        _CURRENCY_SYMBOL_CACHE[code_value] = symbol
        return symbol
    except Exception:
        _CURRENCY_SYMBOL_CACHE[code_value] = ""
        return ""


def _format_number(value: Decimal | None, *, decimal_places: int, grouping: bool = True) -> str:
    if value is None:
        return ""
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return ""
    try:
        places = max(0, int(decimal_places))
    except (TypeError, ValueError):
        places = DEFAULT_DECIMAL_PLACES
    quantum = Decimal("1") / (Decimal("10") ** places) if places > 0 else Decimal("1")
    quantized = numeric.quantize(quantum, rounding=ROUND_HALF_UP)
    try:
        formatted = locale.format_string(f"%.{places}f", float(quantized), grouping=grouping)
    except Exception:
        formatted = f"{quantized:,}"
    if grouping and not formatted.replace(",", "").replace("-", "").replace(".", "").isdigit():
        formatted = f"{quantized:,}"
    return formatted


def format_text(value: Any, *, max_length: int | None = None, collapse_whitespace: bool = True, strip: bool = True, truncate: bool = True) -> str:
    if value is None:
        return ""
    text = str(value)
    if strip:
        text = text.strip()
    if collapse_whitespace:
        text = re.sub(r"\s+", " ", text)
    if max_length and len(text) > int(max_length):
        if truncate:
            text = text[: int(max_length)]
        else:
            raise ValueError(f"Value exceeds maximum length of {int(max_length)}")
    return text


def format_alphanumeric_text(value: Any, *, max_length: int | None = None, collapse_whitespace: bool = True, truncate: bool = True) -> str:
    text = format_text(value, max_length=max_length, collapse_whitespace=collapse_whitespace, truncate=truncate)
    return text


def format_currency_amount(
    value: Any,
    *,
    currency_code: Any = None,
    decimal_places: int | None = None,
    include_symbol: bool = True,
    grouping: bool = True,
) -> str:
    if value in (None, ""):
        return ""
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return ""
    if decimal_places is None:
        decimal_places = DEFAULT_DECIMAL_PLACES
    if include_symbol:
        symbol = _symbol_for(currency_code)
    else:
        symbol = ""
    return f"{symbol}{_format_number(numeric, decimal_places=decimal_places, grouping=grouping)}"


def format_decimal(value: Any, *, decimal_places: int, grouping: bool = True) -> str:
    if value in (None, ""):
        return ""
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return ""
    return _format_number(numeric, decimal_places=decimal_places, grouping=grouping)


def format_integer(value: Any, *, grouping: bool = True) -> str:
    if value in (None, ""):
        return ""
    try:
        if isinstance(value, bool):
            numeric = int(value)
        else:
            numeric = int(Decimal(str(value)).to_integral_value(rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return ""
    if grouping:
        return f"{numeric:,}"
    return str(numeric)


def format_percent(value: Any, *, decimal_places: int = DEFAULT_TAX_DECIMAL_PLACES, grouping: bool = False) -> str:
    if value in (None, ""):
        return ""
    try:
        numeric = Decimal(str(value))
    except (InvalidOperation, TypeError):
        return ""
    return f"{_format_number(numeric, decimal_places=decimal_places, grouping=grouping)}%"


def format_date(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return str(value.isoformat())
    return format_text(value)


def format_datetime(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return str(value.isoformat())
    return format_text(value)


def parse_currency_input(value: Any, *, decimal_places: int | None = None) -> Decimal | None:
    if value in (None, ""):
        return None
    if isinstance(value, Decimal):
        text = str(value)
    elif isinstance(value, (int, float)):
        text = str(value)
    else:
        text = str(value).strip()
    if not text:
        return None
    cleaned = re.sub(r"[^\d.,\-+eE]", "", text)
    if not cleaned:
        raise ValueError("Invalid currency value")
    if cleaned.count(".") and cleaned.count(","):
        raise ValueError("Ambiguous decimal/grouping separator usage in currency value")
    if cleaned.count(",") and not cleaned.count("."):
        if cleaned.count(",") == 1 and len(cleaned.split(",")[-1]) in (1, 2):
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(".") and not cleaned.count(","):
        pass
    elif cleaned.count(",") and cleaned.count("."):
        raise ValueError("Ambiguous decimal/grouping separator usage in currency value")
    try:
        numeric = Decimal(cleaned)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Invalid currency value") from exc
    if decimal_places is None:
        decimal_places = DEFAULT_DECIMAL_PLACES
    quantum = Decimal("1") / (Decimal("10") ** max(0, int(decimal_places)))
    return numeric.quantize(quantum, rounding=ROUND_HALF_UP)


def parse_decimal_input(value: Any, *, decimal_places: int) -> Decimal | None:
    if value in (None, ""):
        return None
    if isinstance(value, Decimal):
        numeric = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        if raw.count(".") and raw.count(","):
            raise ValueError("Ambiguous decimal/grouping separator usage")
        cleaned = raw
        if cleaned.count(",") and not cleaned.count("."):
            if cleaned.count(",") == 1 and len(cleaned.split(",")[-1]) in (1, 2):
                cleaned = cleaned.replace(",", ".")
            else:
                cleaned = cleaned.replace(",", "")
        try:
            numeric = Decimal(cleaned)
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("Invalid decimal value") from exc
    quantum = Decimal("1") / (Decimal("10") ** max(0, int(decimal_places)))
    return numeric.quantize(quantum, rounding=ROUND_HALF_UP)


def parse_integer_input(value: Any) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    normalized = raw.replace(",", "")
    try:
        numeric = Decimal(normalized)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Invalid integer value") from exc
    if not numeric.is_finite() or numeric != numeric.to_integral_value():
        raise ValueError("Invalid integer value")
    return int(numeric)


def normalize_text_column(
    value: Any,
    *,
    max_length: int | None = None,
    collapse_whitespace: bool = True,
    truncate: bool = True,
) -> str | None:
    if value is None:
        return None
    text = format_alphanumeric_text(
        value,
        max_length=max_length,
        collapse_whitespace=collapse_whitespace,
        truncate=truncate,
    )
    if text == "":
        return None
    return text
