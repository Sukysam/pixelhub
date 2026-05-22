# Settings API

Base path: `/api`

Authentication: Token auth via `Authorization: Token <token>` for protected endpoints.

## Auth
### POST /auth/token/
Request:
```json
{ "username": "admin", "password": "..." }
```
Response:
```json
{ "token": "..." }
```

### GET /auth/me/
Response:
```json
{ "id": 1, "username": "admin", "email": "", "is_staff": true, "is_superuser": false }
```

## Settings (User)
### GET /settings/me/
Returns the caller's `UserSettings` row (creates one on first access).

### PATCH /settings/me/
Updates user settings (invoice/receipt templates and preferences).

Example:
```json
{
  "country": "DE",
  "date_format": "DD.MM.YYYY",
  "number_format": "1.234,56",
  "notifications": { "email": true, "in_app": true },
  "invoice_template": { "primary_color": "#2b6cb0", "footer_text": "Danke!" },
  "receipt_template": { "numbering_format": "RCPT-{id}" }
}
```

## Settings (Global/Admin)
### GET /settings/global/
Admin-only. Returns `GlobalSettings` (creates singleton on first access).

### PUT /settings/global/
Admin-only. Updates global defaults.

Example:
```json
{
  "default_currency": 1,
  "allow_user_overrides": true,
  "tax_configuration": { "type": "vat", "default_rate": "20", "inclusive": true },
  "appearance": { "company_name": "MyCo", "primary_color": "#1a4d8e" }
}
```

## Effective Resolution
### GET /settings/effective/
Returns resolved settings:
- `global`: serialized `GlobalSettings`
- `user`: serialized `UserSettings` (or `null`)
- `effective`: merged region + currency + template settings used by the UI

## Regional Defaults / Detection
### GET /settings/country-defaults/?country=DE
Returns defaults and compliance flags for supported countries.

### GET /settings/geo/
Attempts country detection from:
- `country` query param (manual override)
- `CF-IPCountry`, `X-Country-Code`, `X-Country` headers
- `Accept-Language` fallback

## Currency + FX
### GET /currencies/
Lists known currencies (readable by all; write requires admin).

### GET /exchange-rates/
Lists rates (readable by all; write requires admin).

### GET /settings/convert/?amount=10&from=USD&to=EUR
Returns converted amount using direct or inverse FX pair.

## Audit + Rollback
### GET /settings/audit/?scope=all&limit=50
- Admin: returns global + user settings logs
- Non-admin: returns only the caller’s `UserSettings` logs

### POST /settings/rollback/
Request:
```json
{ "audit_log_id": 123 }
```
Rolls back to the `before` snapshot recorded on that audit entry (supported for `GlobalSettings` and `UserSettings`).

## Inventory Export/Import
### GET /items/export/
Exports inventory items.

Query params:
- `file_format`: `csv` | `xlsx` | `pdf` (default: `csv`)
- `fields`: comma-separated allowed fields (default: `type,sku,name,unit_price,tax_rate,stock_quantity,updated_at`)
- `created_from`, `created_to`: `YYYY-MM-DD` (filters by `created_at` date)
- `q`: search by `name`/`sku`
- `type`: `product` | `service`
- `limit`: max rows (default depends on format; hard cap 50,000 for CSV/XLSX)

Response:
- `csv`: `text/csv`
- `xlsx`: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `pdf`: `application/pdf` (may fall back to `text/html` if the PDF backend is unavailable)

### POST /items/import/
Imports items from a CSV/XLSX file.

Content type: `multipart/form-data`

Form fields:
- `file`: required (`.csv` or `.xlsx`)
- `dry_run`: `true|false` (default: `false`)
- `rollback_on_error`: `true|false` (default: `true`)

CSV/XLSX columns:
- Required: `name`, `unit_price`
- Optional: `type` (`product|service`, default `product`), `sku`, `description`, `tax_rate`, `tax_category`, `unit_of_measure`, `stock_quantity`

Response (200):
```json
{ "imported": 10, "rows": 10, "errors": [] }
```

Response (400 when `rollback_on_error=true` and any validation error):
```json
{ "imported": 0, "rows": 10, "errors": [{"row":2,"field":"sku","message":"sku already exists"}], "error_log_token":"...", "rolled_back": true }
```

## Invoice Export/Import
### GET /invoices/export/
Exports invoices using existing invoice filters.

Query params:
- `file_format`: `csv` | `xlsx` | `pdf` (default: `csv`)
- `fields`: comma-separated allowed fields (default: `invoice_number,customer_name,status,issue_date,due_date,subtotal,tax_total,total_amount`)
- `limit`: max rows (default depends on format; hard cap 50,000 for CSV/XLSX)
- All existing invoice filters:
  - `q`, `invoice_number`, `customer_name`, `customer` (id), `status`
  - `issue_date_from`, `issue_date_to`, `due_date_from`, `due_date_to`
  - `total_min`, `total_max`

### POST /invoices/import/
Imports invoices from a CSV/XLSX file where each row is a line item.

Content type: `multipart/form-data`

Form fields:
- `file`: required (`.csv` or `.xlsx`)
- `dry_run`: `true|false` (default: `false`)
- `rollback_on_error`: `true|false` (default: `true`)

CSV/XLSX columns:
- Grouping: `invoice_number` (optional) and/or `invoice_key` (optional)
- Customer: `customer_email` or `customer_name` (one required)
- Invoice header: `status` (default `Draft`), `issue_date`, `due_date`
- Line item: `item_sku` (required), `quantity` (required), optional `unit_price`, `tax_rate`, `description`, `unit_of_measure`

Response (200):
```json
{ "imported_invoices": 3, "imported_invoice_items": 12, "rows": 12, "errors": [] }
```

## Import Error Logs
### GET /imports/error-log/<token>/
Downloads a CSV error report generated by an import attempt.

Notes:
- Error logs are cached temporarily and may expire.
