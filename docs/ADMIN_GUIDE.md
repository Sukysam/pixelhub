# Admin Guide (Settings)

## Access
- Log in with an account that has `is_staff=true`.
- Open **Admin Settings** in the left navigation.
- Only full admins can open the **Users** tab or perform write actions; staff access remains read-only for non-user-management sections.

## Global Settings
### Default Currency
- Sets the system fallback currency used when a user has no currency override.
- Users can override the currency only when **User Overrides** is enabled.

### Appearance
Controls company-level defaults used by invoice PDFs and receipt prints:
- Company name / tagline
- Logo URL
- Primary color
- Invoice footer text
- Receipt footer text

### Tax Configuration
Tax settings are stored as JSON and are intended as defaults and metadata for country adaptation:
- `type`: `vat` | `gst` | `sales_tax`
- `default_rate`: string percent (e.g. `"20"`)
- `inclusive`: boolean (tax-inclusive pricing)

## User Management
From **Users** tab:
- Toggle `Active` to enable/disable sign-in.
- Toggle `Staff` to grant admin access.
- Use **Create User** to add a new account.
- Every create/update action is written to the audit log for traceability.

## Social Sign-In Configuration
- Configure Google with `DJANGO_GOOGLE_OAUTH_CLIENT_ID` and `DJANGO_GOOGLE_OAUTH_CLIENT_SECRET`.
- Configure Facebook with `DJANGO_FACEBOOK_OAUTH_CLIENT_ID` and `DJANGO_FACEBOOK_OAUTH_CLIENT_SECRET`.
- Privileged accounts are intentionally blocked from social sign-in and must use the staff/admin password flow.

## Exchange Rates (FX)
From **FX Rates** tab:
- Add pairs like `USD/EUR` with a decimal rate.
- Rates are used by the conversion endpoint and formatting helpers.
- If a direct pair is missing, conversion falls back to the inverse pair if available.
