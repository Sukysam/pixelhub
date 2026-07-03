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

## Connected Accounts
- Open **Settings** and use **Connected Accounts** to link Google or Facebook to your existing profile.
- Linked providers can be used to sign back in to the same account without creating duplicates.
- If the provider email does not match your existing profile email, the link attempt is rejected for safety.

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

## Customers: Export / Import
### Export
- Open **Customers**.
- Click **Export**.
- Choose `CSV` or `Excel`.
- Optionally filter by **Created From/To**, **Segment**, and **Account Status**.
- Select exactly which columns to include, including derived metrics such as `invoice_count`, `lifetime_value`, `total_paid_amount`, and `order_history`.

### Import
- Open **Customers**.
- Click **Import** and upload a `.csv` or `.xlsx`.
- Download the template first if needed.
- Use **Dry run** to validate without creating records.
- Keep **Rollback on validation error** enabled for all-or-nothing imports.
- If validation fails, use **Download Error Log** for row-level corrections.

Expected columns:
- `name` required
- `email`, `phone`, `billing_address` optional

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

## Expenses: Manage / Export / Import
### Day-to-day management
- Open **Expenses** from the left navigation.
- Use **Add Expense** to create a new record with amount, date, category, vendor, project code or cost center, and an optional digital receipt.
- Use **Edit** to update details or attach a receipt later.
- Use **Approve** or **Reject** to finalize submitted expenses.
- Use the table filters to narrow results by search term, category, approval status, or items assigned to you.

### Policy validation
- Every expense must have a category.
- Every expense must be linked to either a project code or a cost center.
- Expenses at or above `1000.00` are flagged for review until a receipt is attached and approved.
- Future-dated expenses are also flagged for review.

### Export
- Click **Export** on the **Expenses** page.
- Choose `CSV`, `Excel`, or `PDF`.
- Filter by date range, category, approval status, and assignment before downloading.
- Include audit-related fields such as `policy_status`, `policy_notes`, `approved_by`, and `receipt_url` when needed.

### Import
- Click **Import** on the **Expenses** page.
- Upload a `.csv` or `.xlsx` generated from the template.
- Use **Dry run** to preview row counts, errors, and policy flags.
- Use **Rollback on validation error** when you want the import to fail as one unit.
- If the import returns an error log token, download the CSV error report and correct the highlighted rows.

Expected columns:
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
