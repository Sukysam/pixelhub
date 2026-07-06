[OPEN] Debug session: settings-ci-failures

## Symptom
- Firefox: `admin can manage roles and users from settings` times out waiting for `#role_name`.
- WebKit: `standard business user can persist customer invoice and receipt records` times out waiting for invoice PATCH response and a `Confirm` button after invoice row save.

## Scope
- Affects CI only in the latest run.
- Failures are isolated to `frontend/tests/settings.spec.ts`.

## Initial Hypotheses
1. The role dialog opens in Firefox, but the expected field IDs or mount timing changed, so `#role_name` is no longer a reliable readiness signal.
2. The role dialog trigger does not reliably open the dialog in Firefox, leaving the test waiting on fields that never render.
3. The invoice edit flow in WebKit no longer shows a confirmation modal, so the test is waiting for a `Confirm` button that does not appear.
4. The invoice row save interaction is blocked or not committed in WebKit, so the PATCH request never fires.
5. The invoice create/manage route split changed which page owns the editable grid, and WebKit is hitting a different DOM path than Chromium.

## Evidence Plan
- Inspect the current failure artifacts for both tests.
- Add minimal instrumentation to capture headings, dialog presence, field presence, row action buttons, and confirm-dialog presence immediately before the failing waits.
- Reproduce the targeted tests locally where possible and analyze the emitted debug logs before applying a fix.
