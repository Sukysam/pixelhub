# Contributing

## Ways to Contribute

- Report bugs via GitHub Issues (include steps to reproduce, expected vs. actual behavior, and logs/screenshots when applicable).
- Propose features via GitHub Issues (describe the problem, user impact, and any API/UI implications).
- Submit pull requests for fixes and improvements.

## Development Setup

- Follow the setup instructions in `README.md`.
- Keep changes focused and small when possible.
- Add or update tests for behavior changes (Django tests and/or Playwright E2E).

## Pull Requests

- Use a clear title and description that explains the change and rationale.
- Link related issues (e.g. “Fixes #123”).
- Ensure CI passes (lint, tests, build).
- Avoid committing secrets, `.env` files, credentials, or local-only artifacts.

## Code Style

- Frontend: keep `npm run lint` clean and ensure `npm run build` succeeds.
- Backend: ensure `python manage.py test` passes.

## Security

- Never include API keys, access tokens, private keys, or production credentials in commits.
- If you suspect a security issue, report it privately rather than opening a public issue.
