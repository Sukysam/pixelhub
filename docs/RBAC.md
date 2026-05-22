# RBAC (Role-Based Access Control) – PIXELHUB

## Overview
PIXELHUB uses an explicit RBAC data model (roles + permissions) and scoped access tokens to separate authentication and authorization for:
- **User**: regular product user
- **Staff**: operational role with read-only visibility into selected system configuration
- **Admin**: elevated role with write access to system-wide settings and admin functionality

Authentication and authorization are enforced on the API layer and mirrored on the frontend via role-aware UI rendering.

## Role Hierarchy
- **admin**: highest privilege (includes all permissions)
- **staff**: limited privilege (subset of admin; read-only for admin settings)
- **user**: default role (no admin permissions)

## Tokens and Sessions
All authenticated requests use `Authorization: Token <token>` where `<token>` is an `AccessToken`.
- Tokens are scoped to a **role** at issuance time.
- Tokens are revocable (`revoked_at`) and may have expirations (`expires_at`).

### Distinct Authentication Flows
- `POST /api/auth/token/` issues a **user** token
- `POST /api/auth/staff/token/` issues a **staff** token
- `POST /api/auth/admin/token/` issues an **admin** token (requires MFA code)
- `POST /api/auth/admin/mfa/setup/` starts MFA enrollment for admin accounts
- `POST /api/auth/admin/mfa/confirm/` confirms MFA and issues an admin token

### Logout
- `POST /api/auth/logout/` revokes the current token.

## Permissions Matrix
Permission codes are stored in the database and assigned via role-permission mapping.

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
Some fields are treated as sensitive and are not returned to staff:
- `tax_identification_number` is hidden for non-admin callers in:
  - `GET /api/settings/global/`
  - `GET /api/settings/effective/`

## Admin MFA Requirements
Admin authentication requires MFA:
- Admin accounts must enroll in TOTP MFA via `/api/auth/admin/mfa/setup/` and `/api/auth/admin/mfa/confirm/`.
- Admin login requires a current TOTP code (`code`) and enforces basic replay protection.

## Password Policy (Admin)
Admin login enforces a minimum password length of **12 characters**.

## Audit Logging
Admin and security-relevant actions are recorded in the audit log:
- Authentication security events (success/failure/rate limits/MFA flows)
- Global settings updates (before/after snapshots)
- Admin operations (e.g., user management, logo upload)

## OWASP / Security Best Practices
- Always enforce authorization on the server (UI checks are advisory only).
- Use rate limiting on login and MFA endpoints to reduce brute-force attempts.
- Revoke tokens on logout and on password reset confirmation.
- Do not return sensitive fields to roles that do not require them.
- Keep admin MFA mandatory; avoid bypass mechanisms in production.
