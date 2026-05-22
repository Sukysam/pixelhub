# Settings System (Technical)

## Overview
This project implements a dual-role settings system:
- **Admin (system-wide)** settings: global currency, tax configuration, and appearance defaults.
- **User (per-account)** settings: invoice/receipt template customization and personal preferences (language, formats, notifications).

Settings are persisted in the database, protected by role-based access control, and all changes are recorded in an audit log with rollback support.

## Data Model
- `core.Currency`: currency metadata (code, symbol, decimals).
- `core.ExchangeRate`: FX pairs (base_code/quote_code, rate, as_of).
- `core.GlobalSettings`: singleton row (`singleton_key="global"`) for system defaults.
- `core.UserSettings`: one row per user.
- `core.AuditLog`: immutable record of updates/deletes and settings rollbacks.

## Effective Settings Resolution
The effective settings returned to the UI are resolved as follows:
1. Start with `GlobalSettings` (currency default, appearance, tax configuration).
2. If authenticated:
   - Load `UserSettings`.
   - If `GlobalSettings.allow_user_overrides` is enabled, merge invoice/receipt template overrides and allow per-user currency selection.
3. If `UserSettings.country` is missing, attempt to detect a country from request headers or `Accept-Language`.
4. Apply country defaults (formats/tax/compliance) when user/global values are absent.

## Country Configuration Engine
Country defaults are currently backed by a deterministic in-code mapping in the API layer (US/GB/DE/FR/JP/CA/AU) covering:
- Default currency code
- Default date/number formats
- Default tax regime and rate
- Compliance flags (e.g., whether invoices typically require a tax ID)

## Rendering Integration
- Invoice PDF rendering uses WeasyPrint with `core/templates/core/invoice_pdf.html`.
- Receipt print rendering uses `core/templates/core/receipt_print.html`.
- The API injects effective template settings plus currency/date formatted fields to keep templates simple and stable.

## Audit Logging + Rollback
- All global and user settings changes are persisted as `AuditLog` rows.
- Rollback uses the `before` snapshot stored in the audit log to restore the prior state for `GlobalSettings` or `UserSettings`.

