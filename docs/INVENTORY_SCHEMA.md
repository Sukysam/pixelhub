# Inventory Schema

## Item Category Column
- Table/model: `core_item` / `Item`
- Column: `category`
- Type: `VARCHAR(255)`
- Nullability: non-null
- Default: `General`
- Index: composite database index on `is_deleted, category`

## Purpose
- Stores the business-facing product or service category used for inventory organization, filtering, search, export, and import workflows.
- Supports direct category labeling because this project does not currently include a centralized `product_categories` reference table.

## Usage Rules
- API and UI create/update workflows accept `category` as a string field.
- Blank values are rejected by serializer validation.
- Existing records created before this column was introduced are backfilled to `General` by migration `0033_item_category`.
- Inventory list queries support `category` filtering and category-aware full-text search through the existing item list endpoint.

## Operational Notes
- Use stable human-readable labels such as `Hardware`, `Software`, `Office Supplies`, or `Services`.
- If the project later introduces a dedicated category reference table, this column can serve as the migration source for normalized category records.
