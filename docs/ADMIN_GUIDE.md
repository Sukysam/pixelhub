# Admin Guide (Settings)

## Access
- Sign in through the main login page with an authorized admin account.
- Open `/settings`.
- The administrative section is rendered inside Settings only for users with the `admin` role.
- Standard users do not see the administrative module, and staff users do not receive admin-only write access.

## Administration Section
The admin module inside `/settings` consolidates the standalone administrative portal features into one place.

- **System Configuration**
  - Default currency
  - User override policy
  - Company branding
  - Tax defaults
  - Logo upload

- **Exchange Rates**
  - Create, edit, and delete currency pairs
  - Maintain conversion rates used across the platform

## User Management
- Create new accounts directly from Settings
- Edit existing accounts
- Reset passwords
- Activate or deactivate access
- Assign primary roles and custom roles
- Every create or update action is written to the audit log

## Permission Settings
- Create reusable non-system roles
- Update permission bundles for custom roles
- Assign custom roles through the user management workflow

## Audit Log
- Review recent administrative activity from inside Settings
- Track account creation, user updates, role changes, and authentication-related events

## Social Sign-In Configuration
- Configure Google with `DJANGO_GOOGLE_OAUTH_CLIENT_ID` and `DJANGO_GOOGLE_OAUTH_CLIENT_SECRET`.
- Configure Facebook with `DJANGO_FACEBOOK_OAUTH_CLIENT_ID` and `DJANGO_FACEBOOK_OAUTH_CLIENT_SECRET`.
- Standard users can use social sign-in and account linking from Settings.
- Privileged users sign in through the same main password form as everyone else.
