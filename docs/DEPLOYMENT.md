# Deployment Notes

## Backend (Django)
### Environment
- Python 3.11+
- Install dependencies from `requirements.txt`

Recommended local setup:
```bash
python -m venv venv
./venv/bin/pip install -r requirements.txt
```

### Registration / Email verification
Environment variables:
- `FRONTEND_BASE_URL` (used to generate verify-email links)
- `DJANGO_DEFAULT_FROM_EMAIL` (must be a real sender address for best deliverability)
- `DJANGO_SERVER_EMAIL` (optional; defaults to `DJANGO_DEFAULT_FROM_EMAIL`)
- `DJANGO_EMAIL_BACKEND` (defaults to SMTP when `DJANGO_EMAIL_HOST` is set; otherwise console backend in development)
- `DJANGO_EMAIL_HOST`
- `DJANGO_EMAIL_PORT` (default: `587`)
- `DJANGO_EMAIL_HOST_USER`
- `DJANGO_EMAIL_HOST_PASSWORD`
- `DJANGO_EMAIL_USE_TLS` (default: `1`)
- `DJANGO_EMAIL_USE_SSL` (default: `0`)
- `DJANGO_EMAIL_TIMEOUT` (default: `15`)
- `DJANGO_ALLOW_CONSOLE_EMAIL_IN_PROD` (set to `1` only if you explicitly want console email with `DJANGO_DEBUG=0`)
Operational notes:
- Verification email send success/failure is logged to server logs and stored in `AuditLog` (security events).
- Admin-only endpoints are available for monitoring and testing:
  - `GET /api/admin/email/metrics/?hours=24`
  - `POST /api/admin/email/test/` with JSON body `{ "email": "you@example.com" }`

DNS / deliverability (recommended for production sending domains):
- SPF: authorize your SMTP provider in a TXT record for the sending domain.
- DKIM: publish provider DKIM public keys and enable DKIM signing in the provider.
- DMARC: publish a DMARC policy and mailbox for reports (start with `p=none`, then tighten).

Security flags (recommended in production):
- `DJANGO_SECURE_SSL_REDIRECT=1`
- `DJANGO_SESSION_COOKIE_SECURE=1`
- `DJANGO_CSRF_COOKIE_SECURE=1`
- `DJANGO_SECURE_PROXY_SSL_HEADER=1` (recommended behind a reverse proxy/load balancer)
- `DJANGO_USE_X_FORWARDED_HOST=1` (recommended behind a reverse proxy/load balancer)

### Social sign-in (Google / Facebook)
Backend environment variables (supported names):
- Google: `DJANGO_GOOGLE_OAUTH_CLIENT_ID` / `DJANGO_GOOGLE_OAUTH_CLIENT_SECRET` (or `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`)
- Facebook: `DJANGO_FACEBOOK_OAUTH_CLIENT_ID` / `DJANGO_FACEBOOK_OAUTH_CLIENT_SECRET` (or `FACEBOOK_OAUTH_CLIENT_ID` / `FACEBOOK_OAUTH_CLIENT_SECRET`)

Provider redirect URIs to register:
- Google redirect URI: `https://<your-backend-domain>/api/auth/google/callback/`
- Facebook callback URL: `https://<your-backend-domain>/api/auth/facebook/callback/`

Runtime verification (admin-only):
- `GET /api/admin/oauth/status/` returns whether Google/Facebook are configured and the exact callback URLs the server is generating.

### Database
- Development uses SQLite (`db.sqlite3`).
- For production, configure Postgres and update Django settings accordingly.

### Migrations
Run:
```bash
./venv/bin/python manage.py migrate
```

### Running the API
```bash
./venv/bin/python manage.py runserver 0.0.0.0:8000
```

### CORS
If deploying frontend and backend separately, set `DJANGO_CORS_ALLOWED_ORIGINS` (comma-separated) in the backend environment.

## Frontend (Next.js)
### Install
```bash
cd frontend
npm ci
```

### Configure API base URL
Set:
- `NEXT_PUBLIC_API_BASE_URL` (example: `https://api.example.com/api`)

### Run
```bash
npm run dev
```

## Sevalla (GitHub Deployment)
Sevalla (sometimes misspelled “Sevella”) supports GitHub-based deployments. This repository is a monorepo, so deploy the backend and frontend as separate Sevalla applications.

### Backend on Sevalla (Django API)
**Create an Application (Application Hosting)**
- Git provider: GitHub
- Repository: this repo
- Branch: `main`
- Build path: `.`

**Runtime requirements**
- Ensure the web process binds to Sevalla’s `$PORT`.
- Use a production WSGI server (Gunicorn) rather than Django’s dev server.

**Recommended web process start command**
```bash
./venv/bin/python manage.py migrate && ./venv/bin/python manage.py collectstatic --noinput && ./venv/bin/gunicorn pixelhub.wsgi:application -b 0.0.0.0:${PORT:-8080}
```

**Required environment variables (set in Sevalla; do not commit secrets)**
- `DJANGO_DEBUG=0`
- `DJANGO_SECRET_KEY` (generate a long random value)
- `DJANGO_ALLOWED_HOSTS` (comma-separated; include your Sevalla backend domain)
- `DJANGO_CORS_ALLOWED_ORIGINS` (comma-separated; include your Sevalla frontend origin)
- `FRONTEND_BASE_URL` (your Sevalla frontend URL; used for verify-email links)
- Email (production): `DJANGO_EMAIL_HOST`, `DJANGO_EMAIL_HOST_USER`, `DJANGO_EMAIL_HOST_PASSWORD`, `DJANGO_DEFAULT_FROM_EMAIL`
- Database (production): either `DATABASE_URL` or the `POSTGRES_*` variables (recommended: Sevalla-managed Postgres)
- Optional cache: `REDIS_URL`

**Health check**
- Use `GET /api/auth/me/` for an authenticated readiness check, or load the frontend signup page and submit a test registration to verify the public auth flow.

**PDF generation (WeasyPrint)**
- WeasyPrint requires OS-level libraries (cairo/pango/gdk-pixbuf). If you plan to use PDF endpoints in production, ensure your Sevalla build includes the required system dependencies (use Sevalla build strategy settings or a Dockerfile when needed).

### Frontend on Sevalla (Next.js UI)
**Create an Application (Application Hosting)**
- Git provider: GitHub
- Repository: this repo
- Branch: `main`
- Build path: `frontend`

**Build and start**
- Build command: `npm run build`
- Start command: `npm run start`

**Required environment variables**
- `NEXT_PUBLIC_API_BASE_URL` (example: `https://<your-backend-domain>/api`)

**Health check**
- Use `GET /` as a basic check.

### Staging vs Production
Use Sevalla “Preview”/staging environments with a separate set of environment variables. Keep the same values across both environments except for:
- hostnames/URLs (`DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS`, `FRONTEND_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`)
- secrets/keys (`DJANGO_SECRET_KEY`, OAuth secrets, webhook secrets)
- database/cache connection strings

## Tests
### Backend
```bash
./venv/bin/python manage.py test
```

### Registration load test (1000 concurrent registrations)
Start the backend server, then run (development only):
```bash
./venv/bin/python manage.py runserver 0.0.0.0:8000
```
In another terminal:
```bash
./venv/bin/python manage.py load_test_registration --total 1000 --concurrency 100 --url http://127.0.0.1:8000/api/auth/register/
```

### UI (Playwright)
Start backend and frontend, then run (requires `E2E_USERNAME` and `E2E_PASSWORD` in the environment):
```bash
cd frontend
npm run test:e2e
```
