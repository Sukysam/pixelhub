# Debug Session: webkit-reset-disabled
- **Status**: [OPEN]
- **Issue**: WebKit invitation onboarding reaches reset-password, but the `Reset password` button stays disabled and the Playwright test times out.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-webkit-reset-disabled.ndjson

## Reproduction Steps
1. Run `playwright test tests/auth.spec.ts --project=webkit --grep "admin invited user accepts invitation"`.
2. Open the invitation URL generated for the invited user.
3. Fill `New password` and `Confirm new password`.
4. Observe the submit button remains disabled.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | WebKit fills a field visually without committing React state, so `pwOk` or `pwMatch` remains false. | High | Low | Pending |
| B | `uid` or `token` is missing or unstable in WebKit, so `canSubmit` never becomes true. | Medium | Low | Pending |
| C | The shared input component or browser behavior leaves one password field in a stale state only on WebKit. | Medium | Medium | Pending |
| D | Client-side validation became stricter than the test assumptions, and the current generated password fails one rule. | Medium | Low | Pending |

## Log Evidence
- Pre-fix: `/api/auth/verify-email/` returned `400 Invalid token` after `page.goto(adminInvitationUrlForEmail(...))`, so the flow never reached a valid reset-password state.
- Pre-fix cause evidence: `pixelhub/settings.py` generated a random fallback `SECRET_KEY` in debug mode, so `manage.py shell` in the Playwright helper and the running Django server signed/verified invitation tokens with different keys.
- Post-fix: WebKit E2E passed, and `.dbg/trae-debug-log-webkit-reset-disabled.ndjson` shows:
  - mount with `hasUid=true`, `hasToken=true`
  - password change with `issues=[]`
  - confirm change with `matchesNewPassword=true`
  - `canSubmit=true`
  - submit attempt with `canSubmit=true`

## Verification Conclusion
- Hypothesis A: Rejected. React state updated correctly in WebKit once the valid reset page loaded.
- Hypothesis B: Rejected. `uid` and `token` were present on the reset page.
- Hypothesis C: Rejected. The shared input component handled WebKit input normally.
- Hypothesis D: Rejected. The generated password satisfied client validation.
- Root cause: invitation token signing was unstable across Django processes because the debug fallback `SECRET_KEY` was random per process.
