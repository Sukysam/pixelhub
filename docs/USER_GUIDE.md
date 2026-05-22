# User Guide (Settings)

## Access
- Log in to unlock settings customization.
- Open **Settings** in the left navigation.

## Preferences
- **Country**: choose a country to apply regional defaults (currency suggestion, date format, separators). Leave empty to auto-detect.
- **Currency**: optionally select a currency. Availability depends on admin policy (`allow_user_overrides`).
- **Language**: UI preference stored per user.
- **Date / Number formats**: controls how dates and numbers are displayed in templates and previews.
- **Notifications**: simple toggles stored in your profile.

## Invoice Template
Customize your invoices:
- Logo URL
- Primary color
- Font family
- Layout (classic/compact)
- Show/hide item descriptions
- Footer text

The preview updates in real time as you change options.

## Receipt Template
Customize your receipts:
- Header text / footer text
- Logo URL
- Primary color / font family
- Numbering format (supports `{id}` and `{invoice_number}`)
- Show/hide items and item descriptions

## Saving
- Click **Save Changes** and confirm.
- Changes apply immediately to future invoice PDFs and receipt prints.

## Inventory: Export / Import
### Export
- Open **Inventory**.
- Click **Export**.
- Choose a format: CSV, Excel (.xlsx), or PDF.
- Optionally set **Created From/To** and choose which fields to include.

### Import
- Open **Inventory**.
- Click **Import** and upload a `.csv` or `.xlsx`.
- Use **Dry run** to validate without creating records.
- Keep **Rollback on any error** enabled to ensure all-or-nothing imports.
- If validation fails, use **Download Error Log** to get row-level errors.

Expected columns (CSV/XLSX):
- Required: `name`, `unit_price`
- Optional: `type`, `sku`, `description`, `tax_rate`, `tax_category`, `unit_of_measure`, `stock_quantity`

## Invoices: Export / Import
### Export
- Open **Invoices**.
- Apply filters (status/date ranges/customer/amount).
- Click **Export**, choose format + fields, then export.

### Import
- Open **Invoices**.
- Click **Import** and upload a `.csv` or `.xlsx`.
- Each row represents one invoice line item.
- Rows are grouped into invoices by `invoice_number` or `invoice_key`.
- If validation fails, use **Download Error Log** for row-level errors.

Expected columns (CSV/XLSX):
- Grouping: `invoice_number` and/or `invoice_key`
- Customer: `customer_email` or `customer_name`
- Invoice header: `status`, `issue_date`, `due_date`
- Line item: `item_sku`, `quantity`, optional `unit_price`, `tax_rate`, `description`, `unit_of_measure`
