## SukyAcc

SukyAcc is an accounting/invoicing application with a Django REST API backend and a Next.js frontend.

### Features

- Customer, inventory, invoices, receipts, expenses
- Dashboard metrics and reports
- User settings and global admin settings
- Registration with email verification and password reset
- Optional Google/GitHub OAuth sign-in (backend-configured)
- PDF invoice generation (WeasyPrint)
- End-to-end UI tests (Playwright)

## Repository Layout

- `sukyacc/`, `core/`: Django project and app (API at `/api`)
- `frontend/`: Next.js app router UI
- `docs/`: additional guides (deployment, settings, registration)

## Prerequisites

- Python 3.11+
- Node.js 20+ (for `frontend/`)
- Optional (production): PostgreSQL, Redis

## Quick Start (Local)

### Backend (Django API)

```bash
python -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python manage.py migrate
./venv/bin/python manage.py runserver 0.0.0.0:8000
```

API base URL: `http://127.0.0.1:8000/api`

### Frontend (Next.js)

```bash
cd frontend
npm ci
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api npm run dev -p 3003
```

UI URL: `http://127.0.0.1:3003`

## Environment Variables

Copy `.env.example` to `.env` for local use (do not commit `.env`), and configure the following as needed.

### Backend

- `DJANGO_DEBUG` (`1` for local, `0` for production)
- `DJANGO_SECRET_KEY` (required when `DJANGO_DEBUG=0`)
- `DJANGO_ALLOWED_HOSTS` (required when `DJANGO_DEBUG=0`, comma-separated)
- `DJANGO_CORS_ALLOWED_ORIGINS` (required when `DJANGO_DEBUG=0`, comma-separated)
- `FRONTEND_BASE_URL` (used for email verification links)
- Email (production): `DJANGO_EMAIL_HOST`, `DJANGO_EMAIL_HOST_USER`, `DJANGO_EMAIL_HOST_PASSWORD`, `DJANGO_DEFAULT_FROM_EMAIL`
- Optional database (Postgres): `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`
- Optional cache (Redis): `REDIS_URL`
- Optional OAuth: `DJANGO_GOOGLE_OAUTH_CLIENT_ID`, `DJANGO_GOOGLE_OAUTH_CLIENT_SECRET`, `DJANGO_GITHUB_OAUTH_CLIENT_ID`, `DJANGO_GITHUB_OAUTH_CLIENT_SECRET`

### Frontend

- `NEXT_PUBLIC_API_BASE_URL` (example: `https://api.example.com/api`)

## Tests

### Backend

```bash
./venv/bin/python manage.py test
```

### Frontend

```bash
cd frontend
npm run lint
npm run build
```

### E2E (Playwright)

1) Start backend and frontend (see Quick Start).

2) Create a staff user for login-based tests:

```bash
./venv/bin/python manage.py shell -c "import os; from django.contrib.auth.models import User; u, _ = User.objects.get_or_create(username='admin'); u.is_staff=True; u.set_password(os.environ['ADMIN_CRED']); u.save(); print('ready')"
```

3) Run Playwright tests:

```bash
cd frontend
npm run test:e2e
```

## Deployment

See:
- `docs/DEPLOYMENT.md`
- `docs/TECHNICAL_SETTINGS.md`
- `docs/API_SETTINGS.md`

## Contributing

See `CONTRIBUTING.md`.

## License

See `LICENSE`.
