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

## Entity Read APIs
All entity list endpoints are token-protected, paginated, return JSON, and support single-record retrieval by ID.

### GET /customers/
Lists customers with contact details and order summary metadata.

Query params:
- `page`: page number
- `q`: search across `name`, `email`, `phone`, `billing_address`
- `email`, `phone`: field-specific filters
- `created_from`, `created_to`: `YYYY-MM-DD`
- `ordering` or `sort`: `id`, `name`, `email`, `phone`, `created_at`, `updated_at`, `invoice_count`, `lifetime_value`, `last_invoice_date`

List response fields include:
- core customer fields
- `internal_remarks_preview` and `has_internal_remarks` only when the caller has `data.customers.remarks.read`
- `invoice_count`
- `lifetime_value`
- `last_invoice_date`

Notes:
- Full `internal_remarks` content is intentionally omitted from the list response to keep the customer list lightweight and internal-note content lazy-loaded.

### GET /customers/<id>/
Returns a single customer plus `order_history` entries containing invoice number, issue date, due date, status, and total amount.

Notes:
- `internal_remarks` is included only for callers with `data.customers.remarks.read`.

### GET /items/
Lists inventory items with stock/specification metadata.

Query params:
- `page`: page number
- `q`: search across `name`, `sku`, and `category`
- `type`: `product` | `service`
- `category`: partial category match
- `warehouse_location`
- `created_from`, `created_to`: `YYYY-MM-DD`
- `last_restock_from`, `last_restock_to`: `YYYY-MM-DD`
- `stock_min`, `stock_max`: integer stock bounds
- `ordering` or `sort`: `id`, `type`, `sku`, `name`, `category`, `unit_price`, `tax_rate`, `stock_quantity`, `warehouse_location`, `last_restock_date`, `created_at`, `updated_at`

List/detail response fields include:
- core inventory fields
- `category`
- `warehouse_location`
- `last_restock_date`
- `specifications`
- `stock_status`

### GET /items/<id>/
Returns one inventory item plus `recent_invoice_usage` showing recent invoice references and quantities.

## Inventory Export/Import
### GET /items/export/
Exports inventory items.

Query params:
- `file_format`: `csv` | `xlsx` | `pdf` (default: `csv`)
- `fields`: comma-separated allowed fields (default: `type,sku,name,category,unit_price,tax_rate,stock_quantity,updated_at`)
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
- Optional: `type` (`product|service`, default `product`), `sku`, `category` (default `General`), `description`, `tax_rate`, `tax_category`, `unit_of_measure`, `stock_quantity`

Response (200):
```json
{ "imported": 10, "rows": 10, "errors": [] }
```

Response (400 when `rollback_on_error=true` and any validation error):
```json
{ "imported": 0, "rows": 10, "errors": [{"row":2,"field":"sku","message":"sku already exists"}], "error_log_token":"...", "rolled_back": true }
```

## Customer Export/Import
### GET /customers/export/
Exports customer records and derived commercial status.

Query params:
- `file_format`: `csv` | `xlsx` (default: `csv`)
- `fields`: comma-separated allowed fields from `name,email,phone,billing_address,account_status,segment,invoice_count,lifetime_value,total_paid_amount,last_invoice_date,order_history,created_at,updated_at`
- `created_from`, `created_to`: `YYYY-MM-DD`
- `segment`: `prospect` | `standard` | `vip`
- `account_status`: `active` | `prospect` | `inactive`
- plus existing customer filters such as `q`, `email`, and `phone`

Notes:
- `account_status` is derived from invoice activity.
- `segment` is derived from invoice count and lifetime value.
- `order_history` is exported as a compact string of recent invoice references.

### GET /customers/import_template/
Downloads a CSV/XLSX template with columns:
- `name`
- `email`
- `phone`
- `billing_address`

### POST /customers/import/
Imports customers from CSV/XLSX.

Form fields:
- `file`: required (`.csv` or `.xlsx`)
- `dry_run`: `true|false` (default: `false`)
- `rollback_on_error`: `true|false` (default: `true`)

Validation:
- `name` is required
- `email` must be valid if supplied
- duplicate emails in the file or existing active customer set are rejected

Success response:
```json
{ "imported": 25, "rows": 25, "errors": [] }
```

Rollback error response:
```json
{ "imported": 0, "rows": 3, "errors": [{"row":2,"field":"email","message":"email already exists"}], "error_log_token":"...", "rolled_back": true }
```

## Invoice Read APIs
### GET /invoices/
Lists invoices with customer, totals, payment progress, and line-item count metadata.

Query params:
- `page`
- `q`, `invoice_number`, `customer_name`, `customer`
- `status`
- `payment_status`: `paid` | `partial` | `unpaid`
- `issue_date_from`, `issue_date_to`, `due_date_from`, `due_date_to`
- `total_min`, `total_max`
- `ordering` or `sort`: `id`, `invoice_number`, `customer_name`, `issue_date`, `due_date`, `status`, `subtotal`, `tax_total`, `total_amount`, `amount_paid`, `payment_date`, `updated_at`

List/detail response fields include:
- core invoice fields
- nested `invoice_items`
- `customer_name`, `customer_email`
- `amount_paid`
- `balance_due`
- `payment_status`
- `line_item_count`

### GET /invoices/<id>/
Returns one invoice with line items, customer context, totals, payment progress, and due date metadata.

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

## Receipt Read APIs
### GET /receipts/
Lists receipts with linked invoice and customer metadata.

Query params:
- `page`
- `q`: search across `reference_number`, `invoice_number`, `customer_name`
- `invoice_number`
- `customer_name`
- `payment_method`
- `payment_date_from`, `payment_date_to`
- `updated_from`, `updated_to`
- `amount_min`, `amount_max`
- `ordering` or `sort`: `id`, `invoice_number`, `customer_name`, `amount_paid`, `payment_date`, `payment_method`, `reference_number`, `transaction_timestamp`, `updated_at`

List/detail response fields include:
- core receipt fields
- `invoice_number`
- `invoice_status`
- `invoice_total`
- `customer_id`
- `customer_name`
- `transaction_timestamp`

### GET /receipts/<id>/
Returns one receipt plus `linked_invoice` with invoice number, status, total amount, customer association, and due date.

## Expense Read APIs
### GET /expenses/
Lists expenses with approval, policy, assignment, and receipt metadata.

Query params:
- `page`
- `q`: searches category, description, vendor, reference, project/cost center, and assigned username
- `category`
- `approval_status`: `draft` | `submitted` | `approved` | `rejected`
- `policy_status`: `compliant` | `review_required` | `non_compliant`
- `assigned_to`: numeric user id, username fragment, or `me`
- `project_code`, `cost_center`
- `expense_date_from`, `expense_date_to`
- `amount_min`, `amount_max`
- `ordering` or `sort`: `id`, `amount`, `expense_date`, `category`, `vendor`, `approval_status`, `policy_status`, `assigned_to`, `project_code`, `cost_center`, `created_at`, `updated_at`

List/detail response fields include:
- core expense fields
- `receipt_url`
- `assigned_to_name`
- `created_by_name`
- `approved_by_name`
- `policy_status`
- `policy_notes`

### POST /expenses/<id>/approve/
Approves or rejects an expense.

Body:
```json
{ "approval_status": "approved", "policy_notes": "Reviewed and accepted" }
```

### GET /expenses/export/
Exports expenses in `csv`, `xlsx`, or `pdf`.

Query params:
- `file_format`: `csv` | `xlsx` | `pdf`
- `fields`: comma-separated allowed fields from `expense_date,amount,category,description,vendor,merchant_reference,project_code,cost_center,approval_status,policy_status,policy_notes,assigned_to,created_by,approved_by,approved_at,receipt_url,created_at,updated_at`
- all standard expense filters listed above

### GET /expenses/import_template/
Downloads a CSV/XLSX template with columns:
- `amount`
- `expense_date`
- `category`
- `description`
- `vendor`
- `merchant_reference`
- `project_code`
- `cost_center`
- `assigned_to`
- `approval_status`

### POST /expenses/import/
Imports expenses from CSV/XLSX.

Validation and policy behavior:
- `amount` must be positive
- `category` is required
- one of `project_code` or `cost_center` is required
- `assigned_to` must resolve to an existing username if supplied
- amounts `>= 1000.00` are imported with `policy_status=review_required` until a receipt is uploaded and approved
- future-dated expenses are flagged for review

Success response:
```json
{ "imported": 12, "rows": 12, "errors": [], "flags": [{"row":2,"status":"review_required","notes":"Receipt upload required after import for expenses >= 1000.00"}] }
```

## Import Error Logs
### GET /imports/error-log/<token>/
Downloads a CSV error report generated by an import attempt.

Notes:
- Error logs are cached temporarily and may expire.
