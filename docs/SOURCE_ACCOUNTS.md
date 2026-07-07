# Source Account Management

## Overview

The expenses module now includes first-class Source Account management for controlled funding sources such as `petty1`, `petty2`, bank accounts, and mobile-money wallets.

Source Accounts are managed through the Expenses page and are stored as dedicated records instead of free-text labels.

## Data Model

Each Source Account stores:

- `name`
- `account_type`
- `initial_balance`
- `currency`
- `status`
- audit metadata from the shared soft-delete model

Expenses reference Source Accounts by foreign key. Historical expenses keep their Source Account relationship even after an account is deleted from active management.

## Permissions

RBAC codes:

- `data.source_accounts.read`
- `data.source_accounts.write`

Role grants seeded by migration:

- `viewer`: read only
- `editor`: read/write
- `manager`: read/write
- `user`: read/write
- `staff`: read/write
- `admin`: read/write

Create, edit, and delete operations are blocked server-side for users without `data.source_accounts.write`.

## Delete Behavior

Deleting a Source Account is implemented as a soft delete with an explicit confirmation keyword.

Behavior:

- the account status is set to `closed`
- the account is hidden from new expense selection
- linked historical expenses are preserved for reporting and audit history
- the delete audit entry records the number of active dependent expenses at the time of deletion

## Validation

Server-side validation includes:

- trimmed account names
- required currency
- `initial_balance >= 0`
- expense create/update restricted to active Source Accounts only
- import validation requiring a known active Source Account name when the column is provided

## UI Usage

From the Expenses page:

1. Open `New Source Account`
2. Enter the account name, type, initial balance, currency, and status
3. Save the account
4. Select the account when creating or editing an expense
5. Use the Source Accounts table to edit or delete managed accounts

## Audit Logging

Source Account create, update, and delete operations are recorded in the shared audit log with:

- acting user
- timestamp
- changed fields
- dependency information on delete

## Testing

Coverage for Source Accounts includes:

- backend CRUD and permission checks
- delete behavior with linked expenses preserved
- expense API integration with Source Account IDs
- import validation by Source Account name
- end-to-end UI workflow for create, edit, delete, and expense linkage
