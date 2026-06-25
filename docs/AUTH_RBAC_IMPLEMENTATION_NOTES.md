# Auth and RBAC Implementation Notes

## Scope
- Social authentication was aligned around Google and Facebook for end-user sign-in.
- Account linking was added so one user profile can own both Google and Facebook identities.
- Admin and user responsibilities were separated more strictly in both API behavior and frontend navigation.
- Audit coverage was expanded for admin user management and social-link events.

## Root Cause Analysis
### Social authentication inconsistencies
- The frontend had already moved away from GitHub, but the backend still contained legacy GitHub OAuth endpoints and configuration.
- Social identities were not persisted in a dedicated model, which made reliable account linking and linked-account display impossible.
- Error handling around provider failures was fragmented, so failed exchanges and missing identity fields were not surfaced consistently.

### Role separation and permission risks
- User-facing and admin-facing flows shared too much surface area, which increased the chance of staff or standard users seeing controls that did not match their actual privileges.
- Admin user-management actions needed clearer authorization boundaries and auditable write tracking.
- Privileged accounts needed to be prevented from entering the standard user social-login flow.

### Validation and environment drift
- Local verification initially failed because declared backend dependencies (`openpyxl`, `whitenoise`) were missing from the virtual environment even though they were already listed in `requirements.txt`.
- The new `SocialAuthConnection` schema also required the pending migration to be applied before browser-level testing.

## Backend Changes
- Added `SocialAuthConnection` with uniqueness constraints for `provider + provider_user_id` and `user + provider`.
- Added migration `core.0020_socialauthconnection`.
- Extended `/api/auth/me/` to include `session_role` and linked social account metadata.
- Added `/api/auth/social/connections/` for the Settings page connected-account status UI.
- Added Facebook OAuth start/callback endpoints alongside the existing Google flow.
- Added centralized social-login and social-link completion helpers to keep provisioning, linking, and audit behavior consistent.
- Blocked privileged accounts from the standard social-login path and redirected them with a specific error code.
- Ensured first-time social sign-in provisions an active user, marks email as verified, and assigns the default `user` role.
- Added audit/security events for social linking and admin create/update actions.

## Frontend Changes
- Replaced the public GitHub sign-in button with Facebook so the landing page matches the supported end-user providers.
- Added richer auth callback handling for provider-specific errors and successful linking redirects.
- Added a `Connected Accounts` section in Settings with provider state, connect/reconnect actions, and success messaging.
- Tightened the Admin Settings users tab so only full admins can access user-management UI actions.

## Testing and Validation
### Backend
- `./venv/bin/python manage.py test core.tests.OAuthRedirectTests core.tests.AuthApiTests --keepdb`
- `./venv/bin/python manage.py test core.tests.SettingsTests core.tests.ApiCoverageTests.test_geo_and_audit_and_admin_users core.tests.ApiCoverageTests.test_currency_and_exchange_rate_crud --keepdb`
- `./venv/bin/python manage.py test core.tests.AuthApiTests.test_google_callback_links_social_account_to_existing_profile core.tests.AuthApiTests.test_google_callback_blocks_privileged_account_from_social_sign_in --keepdb`

### Frontend
- `npm run lint`
- `npx playwright test tests/auth.spec.ts --project=chromium --project=firefox --project=webkit`
- `npx playwright test tests/settings.spec.ts --project=chromium -g "user can update invoice footer in settings|user can select NGN currency in settings"`

### Migration / setup
- `./venv/bin/python manage.py migrate`

## Verification Results
- Google and Facebook entry points now return deterministic redirect/error states.
- Linked-account data is exposed to the authenticated user profile and Settings screen.
- Google linking to an existing profile is covered by an automated backend regression test.
- Privileged-account social sign-in blocking is covered by an automated backend regression test.
- Admin-only user-management access is enforced in backend tests and mirrored in the frontend tab gating.
- Public auth flows pass in Chromium, Firefox, and WebKit.
- Core user settings flows modified by this work pass in browser automation.

## Compatibility Note
- Legacy GitHub OAuth backend endpoints and configuration were removed to keep the codebase aligned with the supported Google/Facebook architecture.
