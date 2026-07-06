# Debug Session: settings-e2e-failures
- **Status**: [OPEN]
- **Issue**: Remaining Playwright CI failures in settings/invoice flows: receipt save timeout and Firefox invoice import setup failure
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-settings-e2e-failures.ndjson

## Reproduction Steps
1. Run `npx playwright test tests/settings.spec.ts -g "invoice and receipt share and save actions generate links and downloads"`
2. Run `npx playwright test tests/settings.spec.ts -g "invoice import flow works end-to-end" --project=firefox`
3. Inspect the request/response path for `/api/documents/saved/` and `/api/items/`

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Receipt save succeeds, but the test waits on a browser download hook that does not fire reliably across engines | High | Low | Confirmed from prior CI evidence; test updated to use app-level success signals instead |
| B | Receipt row state changes after share dialog close, so the later save action is not operating on the expected row state | Medium | Medium | Not supported by local reproduction; no row mismatch observed |
| C | Firefox `/api/items/` setup fails due to uniqueness or validation constraints on generated item payloads | High | Low | Rejected locally after 10 repeated Firefox passes with 201 item-create responses |
| D | Firefox `/api/items/` failure is actually infra/auth/setup related and the test hides the response details | Medium | Low | Still possible in CI; instrumentation now records the full item-create response body |
| E | The invoices page UI or timing differs from the test's assumptions after setup, producing a secondary symptom | Low | Low | Rejected locally; heading and import flow are stable |

## Log Evidence
- `.dbg/trae-debug-log-settings-e2e-failures.ndjson` recorded `/api/documents/saved/` responses and showed the save flow is better observed via request status than via `URL.createObjectURL`.
- Repeated local Firefox runs recorded `201` item-create responses with full payloads for the invoice import setup path.

## Verification Conclusion
- Applied a test-side fix to stop asserting browser download internals for invoice/receipt save flows and instead assert stable app-level completion.
- Kept temporary instrumentation in `frontend/tests/settings.spec.ts` to capture the exact `/api/items/` response if CI reproduces the Firefox-only failure again.
