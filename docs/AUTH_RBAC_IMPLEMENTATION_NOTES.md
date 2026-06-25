# Auth and RBAC Implementation Notes

## Scope
- The public "Login as" selector and standalone privileged portal prompts were removed from the main authentication screen.
- The create-account experience was rebuilt around the requested email, password, company, and Nigeria-focused phone fields with inline validation and legal links.
- The registration backend contract was simplified to the new field set and now keeps email/password onboarding aligned with mandatory verification before first login.
- Administrative tooling was consolidated into the main `/settings` experience for authorized admins.
- Social authentication was aligned around Google and Facebook for end-user sign-in.
- Account linking was added so one user profile can own both Google and Facebook identities.
- Admin and user responsibilities were separated more strictly in API permissions and frontend rendering.
- Audit coverage was expanded for admin user management and social-link events.

## Root Cause Analysis
### Social authentication inconsistencies
- The frontend had already moved away from GitHub, but the backend still contained legacy GitHub OAuth endpoints and configuration.
- Social identities were not persisted in a dedicated model, which made reliable account linking and linked-account display impossible.
- Error handling around provider failures was fragmented, so failed exchanges and missing identity fields were not surfaced consistently.

### Role separation and permission risks
- The public authentication screen exposed role-switching affordances and a separate portal prompt, which blurred the line between standard and privileged access paths.
- User-facing and admin-facing flows shared too much surface area, which increased the chance of staff or standard users seeing controls that did not match their actual privileges.
- Admin user-management actions needed clearer authorization boundaries and auditable write tracking.
- The split portal model introduced extra routes, duplicated sign-in flows, and documentation drift.

### Registration mismatch
- The previous registration form collected a wider business onboarding dataset than the requested create-account journey and did not match the required Nigeria-first phone/country experience.
- Registration created active accounts immediately, which conflicted with the intended email-verification activation workflow.
- The UI and automated tests assumed successful post-registration login instead of a verify-before-login flow.

### Validation and environment drift
- Local verification initially failed because declared backend dependencies (`openpyxl`, `whitenoise`) were missing from the virtual environment even though they were already listed in `requirements.txt`.
- The new `SocialAuthConnection` schema also required the pending migration to be applied before browser-level testing.

## Backend Changes
- Updated `RegisterSerializer` and `/api/auth/register/` to accept `company_name`, `country_code`, `phone_number`, `country`, and `accept_terms`.
- Added Nigerian phone normalization and duplicate phone checks before account creation.
- Changed email/password self-registration to create inactive accounts until `/api/auth/verify-email/` marks them active.
- Seeded `viewer`, `editor`, and `manager` RBAC roles in `core.0021_seed_management_roles`.
- Expanded `/api/auth/me/` to include permission codes alongside roles and session role.
- Added `/api/admin/roles/` for reading and maintaining reusable role definitions.
- Added `/api/admin/audit-logs/` for recent audit and login-activity visibility in the admin workspace.
- Expanded `/api/admin/users/` to support primary role assignment, custom roles, profile fields, activation changes, and password resets.
- Added `SocialAuthConnection` with uniqueness constraints for `provider + provider_user_id` and `user + provider`.
- Added migration `core.0020_socialauthconnection`.
- Extended `/api/auth/me/` to include `session_role` and linked social account metadata.
- Added `/api/auth/social/connections/` for the Settings page connected-account status UI.
- Added Facebook OAuth start/callback endpoints alongside the existing Google flow.
- Added centralized social-login and social-link completion helpers to keep provisioning, linking, and audit behavior consistent.
- Unified password login for standard, staff, and admin accounts through `POST /api/auth/token/`, with the issued session role derived from RBAC permissions.
- Removed the standalone privileged auth endpoints:
  - `/api/auth/staff/token/`
  - `/api/auth/admin/token/`
  - `/api/auth/admin/mfa/setup/`
  - `/api/auth/admin/mfa/confirm/`
- Privileged-account social sign-in errors now redirect users back to the main sign-in flow instead of a separate portal.
- Ensured first-time social sign-in provisions an active user, marks email as verified, and assigns the default `user` role.
- Added audit/security events for social linking and admin create/update actions.

## Frontend Changes
- Removed the main landing-page role selector and deleted the public portal block that linked to separate staff/admin login pages.
- Replaced the redirect-only `/register` route with a full create-account page that matches the requested field order, validation behavior, and Terms/Privacy links.
- Added public `/terms` and `/privacy` pages for the linked legal footer content.
- Deleted standalone `frontend/app/admin-login/page.tsx`, `frontend/app/staff-login/page.tsx`, and `frontend/app/admin/settings/page.tsx`.
- Embedded the `AdminSettingsModule` inside the main `/settings` page and gated it behind the `admin` role.
- Consolidated admin user management, role management, audit visibility, exchange rates, branding, and system configuration into the Settings screen.
- Replaced the public GitHub sign-in button with Facebook so the landing page matches the supported end-user providers.
- Added richer auth callback handling for provider-specific errors and successful linking redirects.
- Added a `Connected Accounts` section in Settings with provider state, connect/reconnect actions, and success messaging.
- Removed the separate admin navigation destination so administrative users manage everything from `/settings`.

## Testing and Validation
### Backend
- `./venv/bin/python manage.py test core.tests.RegistrationTests core.tests.AuthApiTests.test_register_and_duplicate_email core.tests.ApiCoverageTests.test_geo_and_audit_and_admin_users --keepdb`
- `./venv/bin/python manage.py test core.tests.OAuthRedirectTests core.tests.AuthApiTests --keepdb`
- `./venv/bin/python manage.py test core.tests.SettingsTests core.tests.ApiCoverageTests.test_geo_and_audit_and_admin_users core.tests.ApiCoverageTests.test_currency_and_exchange_rate_crud --keepdb`
- `./venv/bin/python manage.py test core.tests.AuthApiTests.test_google_callback_links_social_account_to_existing_profile core.tests.AuthApiTests.test_google_callback_blocks_privileged_account_from_social_sign_in --keepdb`

### Frontend
- `npm run lint`
- `npm run build`
- `npx playwright test tests/auth.spec.ts --project=chromium --project=firefox --project=webkit`
- `npx playwright test tests/settings.spec.ts --project=chromium -g "user can update invoice footer in settings|user can select NGN currency in settings"`

### Migration / setup
- `./venv/bin/python manage.py migrate`

## Verification Results
- The public landing page no longer exposes a combined role-switching login control or a "Need a different portal?" block.
- Self-registration now requires email verification before the new account can authenticate with the standard login flow.
- The new `/register` route builds successfully and validates the requested field order, password indicator, phone checks, and legal links.
- Standalone staff/admin login pages and dedicated admin dashboard routes were removed from the user-facing application.
- Administrative capabilities now live in the main `/settings` page for authorized admins only.
- Google and Facebook entry points now return deterministic redirect/error states.
- Linked-account data is exposed to the authenticated user profile and Settings screen.
- Google linking to an existing profile is covered by an automated backend regression test.
- Privileged-account social sign-in blocking is covered by an automated backend regression test.
- Admin-only user-management access is enforced in backend tests and mirrored in the frontend settings-module gating.
- Public auth flows pass in Chromium, Firefox, and WebKit.
- Core user settings flows modified by this work pass in browser automation.

## Compatibility Note
- Legacy GitHub OAuth backend endpoints and configuration were removed to keep the codebase aligned with the supported Google/Facebook architecture.
