# RBAC (Role-Based Access Control) – PIXELHUB

## Overview
PIXELHUB uses database-backed roles, permissions, and scoped access tokens to separate standard user activity from elevated administration.

- **user**: regular product access
- **staff**: operational access to selected read-only administrative data
- **admin**: full administrative access

Authentication and authorization are enforced on the API and mirrored in the frontend. Administrative tools now live inside the main `/settings` screen and are rendered only for authorized admin users.

## Role Hierarchy
- **admin**: highest privilege, including write access to administrative features
- **staff**: limited privilege with selected read-only access
- **user**: default role with no administrative permissions

## Tokens and Sessions
All authenticated requests use `Authorization: Token <token>` where `<token>` is an `AccessToken`.

- `POST /api/auth/token/` is the single password-based login endpoint for all accounts.
- The issued token is scoped to the resolved session role (`user`, `staff`, or `admin`).
- Tokens are revocable (`revoked_at`) and may expire (`expires_at`).
- `POST /api/auth/logout/` revokes the current token.

## Authentication Model
- Standard, staff, and admin accounts all sign in through the main login form.
- Standalone privileged login routes and privileged token endpoints were removed.
- Social sign-in remains available for standard user sessions.
- If a privileged account attempts a social login path that is not allowed, the UI redirects the user back to the main sign-in flow.

## Permissions Matrix
Permission codes are stored in the database and assigned through role-permission mappings.

| Capability | Permission code | user | staff | admin |
|---|---:|:---:|:---:|:---:|
| View global settings | `settings.global.read` | ✗ | ✓ | ✓ |
| Modify global settings | `settings.global.write` | ✗ | ✗ | ✓ |
| View users | `admin.users.read` | ✗ | ✗ | ✓ |
| Manage users | `admin.users.write` | ✗ | ✗ | ✓ |
| Upload logo | `admin.logo.upload` | ✗ | ✗ | ✓ |
| View OAuth status | `admin.oauth.status.read` | ✗ | ✗ | ✓ |
| Send test email / view email metrics | `admin.email.test` | ✗ | ✗ | ✓ |
| View exchange rates | `fx.read` | ✗ | ✓ | ✓ |
| Manage exchange rates | `fx.write` | ✗ | ✗ | ✓ |
| Manage currencies | `currency.write` | ✗ | ✗ | ✓ |

## Sensitive Data Handling
Sensitive fields are filtered for non-admin callers.

- `tax_identification_number` is hidden for non-admin callers in:
  - `GET /api/settings/global/`
  - `GET /api/settings/effective/`

## Administrative Surface
Administrative APIs still live under `/api/admin/*`, but the user-facing admin interface is no longer split into separate portals.

- Admin UI entry point: `/settings`
- Main admin sections inside Settings:
  - system configuration
  - exchange rates
  - user management
  - permission settings
  - audit log

## Audit Logging
Administrative and security-relevant actions are recorded in the audit log.

- Authentication security events
- Global settings updates
- User and role management actions
- Logo upload activity
- Social account linking events

## Security Notes
- Always enforce authorization on the server; frontend checks are advisory only.
- Keep rate limiting on authentication endpoints to reduce brute-force attempts.
- Revoke tokens on logout and on password reset confirmation.
- Do not return sensitive fields to roles that do not require them.
