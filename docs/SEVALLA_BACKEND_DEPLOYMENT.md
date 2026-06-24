# Sevalla Backend Deployment Guide for PIXELHUB

This guide provides step-by-step instructions for deploying the PIXELHUB backend (Django API) to the Sevalla platform.

## 1. Prerequisites

- A [Sevalla](https://sevalla.com/) account.
- A GitHub repository containing the PIXELHUB source code.
- (Optional) A production database (Sevalla provides managed Postgres).

## 2. Local Setup Verification

Before deploying, ensure the backend runs correctly locally:

```bash
python -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python manage.py migrate
./venv/bin/python manage.py runserver
```

Visit http://localhost:8000/api/auth/register/ with a REST client or load the frontend signup page to verify the auth API is reachable.

## 3. Backend Sevalla Application Setup

### 3.1 Create a New Backend Application

1. Go to **Applications** in the Sevalla dashboard.
2. Click **Add application**.
3. Select **GitHub** as the source.
4. Choose your PIXELHUB repository.
5. Select the branch you wish to deploy (e.g., `main`).
6. **Critical Configuration**:
   - **Application Name**: `pixelhub-api` (or your preferred name)
   - **Build Path / Root Directory**: `.` (project root)
   - **Build Strategy**: Nixpacks (default; we've already created `nixpacks.toml` for you!)

### 3.2 Configure Environment Variables

Under the **Environment Variables** tab for your new backend application, add:

```bash
# Core Django Settings
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<generate a long, random secret key>
DJANGO_ALLOWED_HOSTS=<your-sevalla-backend-domain>,localhost,127.0.0.1
DJANGO_CORS_ALLOWED_ORIGINS=<your-sevalla-frontend-domain>,http://localhost:3000

# Frontend Configuration (for email verification links)
FRONTEND_BASE_URL=<your-sevalla-frontend-url>

# Email Configuration (optional but recommended for production)
DJANGO_EMAIL_HOST=<your-smtp-host>
DJANGO_EMAIL_PORT=587
DJANGO_EMAIL_HOST_USER=<your-smtp-user>
DJANGO_EMAIL_HOST_PASSWORD=<your-smtp-password>
DJANGO_DEFAULT_FROM_EMAIL=noreply@yourdomain.com
DJANGO_EMAIL_USE_TLS=1

# Database (Sevalla-managed Postgres recommended)
# If using Sevalla Postgres, they'll provide a DATABASE_URL
# Otherwise, set POSTGRES_* variables
```

### 3.3 (Optional) Add a Sevalla-Managed Database

1. In your Sevalla project, go to **Databases**.
2. Click **Add Database** → Select Postgres.
3. Follow the prompts to create the database.
4. Sevalla will provide a `DATABASE_URL` that you can add to your backend environment variables.

## 4. How to Get Your Backend API URL

Once your backend application is deployed and marked as **Live** in Sevalla:
1. Go to your Sevalla backend application's **Overview** tab.
2. Look for the **Public URL** or **Domain** section.
3. Your API base URL will be: `<public-url>/api` (e.g., `https://pixelhub-api.sevalla.app/api`)

## 5. Post-Deployment Verification

1. Open your backend API base URL (e.g., `https://pixelhub-api.sevalla.app/api/`) and verify it responds, or load the frontend signup page and submit a test registration.
2. (If email configured) Test email sending via the admin-only endpoint:
   - First, create an admin user using the Django shell (via Sevalla's console or locally):
     ```bash
     ./venv/bin/python manage.py createsuperuser
     ```
   - Then send a test email: `POST /api/admin/email/test/` with JSON body `{ "email": "you@example.com" }`

## 6. Troubleshooting

- **Build fails**: Check the Sevalla build logs for errors (common issues: missing dependencies, incorrect environment variables).
- **CORS errors**: Ensure `DJANGO_CORS_ALLOWED_ORIGINS` includes your frontend's Sevalla URL.
- **PDF generation fails**: Verify that WeasyPrint's system dependencies (cairo/pango/gdk-pixbuf) are installed (we included them in `nixpacks.toml`).
