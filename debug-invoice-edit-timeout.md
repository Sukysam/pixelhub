[OPEN] Debug session: invoice-edit-timeout

## Symptom
- Playwright E2E test `standard business user can persist customer invoice and receipt records` times out waiting for the invoice row `Edit` button in `frontend/tests/settings.spec.ts`.

## Scope
- Affects Chromium, Firefox, and WebKit in CI.
- Failure point is after invoice creation, when the test tries to edit the created invoice from the invoice list.

## Initial Hypotheses
1. The test remains on the create-focused invoice view and does not transition to the correct management context before looking for the `Edit` button.
2. The created invoice exists but is not visible in the currently rendered table because of filtering, pagination, or ordering.
3. The row action set changed and the selector is waiting for an `Edit` button that is not rendered for the created invoice state.
4. A loading or overlay state prevents the invoice row buttons from becoming interactable after creation.
5. The route split between create/manage invoice pages introduced a navigation mismatch in the test flow.

## Evidence Plan
- Inspect current test flow and failure artifacts.
- Add minimal instrumentation to record route, visible headings, and invoice row action labels after invoice creation and before the `Edit` click.
- Reproduce the targeted Playwright failure and compare emitted logs against the hypotheses.
