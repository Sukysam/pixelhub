# Sevalla Frontend Deployment Guide for PIXELHUB

This guide provides step-by-step instructions for deploying the PIXELHUB frontend application to the Sevalla platform.

## 1. Prerequisites

- A [Sevalla](https://sevalla.com/) account.
- A GitHub repository containing the PIXELHUB source code.
- Backend API URL (already deployed on Sevalla or elsewhere).

## 2. Local Testing and Verification

Before deploying, ensure the application builds correctly locally:

```bash
cd frontend
npm ci
npm run build
```

This should generate a `.next/standalone` directory if `output: 'standalone'` is configured in `next.config.mjs`.

## 3. Sevalla Account Setup

1.  Log in to your Sevalla dashboard.
2.  Ensure you have a "Company" and "Project" created to house your application.

## 4. Project Connection Steps

1.  Go to **Applications** in the Sevalla dashboard.
2.  Click **Add application**.
3.  Select **GitHub** as the source.
4.  Choose the `Sukysam/pixelhub` repository.
5.  Select the branch you wish to deploy (e.g., `main`).
6.  **Critical Configuration**:
    -   **Application Name**: `pixelhub-frontend`
    -   **Build Path / Root Directory**: `frontend`
    -   **Build Strategy**: Nixpacks (default)

## 5. Environment Variable Configuration

Under the **Environment Variables** tab for your new application, add the following:

-   `NEXT_PUBLIC_API_BASE_URL`: The full URL to your backend API (e.g., `https://pixelhub-api.sevalla.app/api`).
-   `PORT`: `3000` (Sevalla will automatically bind to this, but you can explicitly set it).

## 6. Build and Start Commands

If Nixpacks doesn't automatically detect the correct commands, use these in the **Processes** > **Web Process** settings:

-   **Build Command**: `npm run build`
-   **Start Command**: `npm run start`

*Note: The `nixpacks.toml` file in the `frontend` directory already specifies these defaults for Sevalla. If your host deploys from the repo root instead, set `APP_RUNTIME=frontend` so the root `nixpacks.toml` switches to the frontend build.*

## 7. Post-Deployment Validation

Once the deployment is "Live":

1.  Open the provided Sevalla URL (e.g., `https://pixelhub-frontend.sevalla.app`).
2.  Check the browser console (F12) for any "Mixed Content" or CORS errors.
3.  Verify that you can reach the login/registration pages and they interact correctly with the backend.
4.  Check that images and assets load correctly.

## 8. Error Handling & Troubleshooting

### Build Failures
-   **Cause**: Missing dependencies or TypeScript errors.
-   **Solution**: Run `npm run lint` and `npm run build` locally to identify and fix errors before pushing. Ensure `package-lock.json` is up to date.

### Routing Misconfigurations (404s)
-   **Cause**: Incorrect `basePath` or `basePath` misaligned with Sevalla's domain setup.
-   **Solution**: Check `next.config.mjs` and the `NEXT_PUBLIC_BASE_PATH` environment variable.

### Asset Loading Errors
-   **Cause**: Incorrect `assetPrefix`.
-   **Solution**: Ensure `assetPrefix` in `next.config.mjs` is correctly handled based on whether the app is on a custom domain or a subdirectory.

### CORS Errors
-   **Cause**: Backend doesn't allow the frontend domain.
-   **Solution**: Update the backend's `DJANGO_CORS_ALLOWED_ORIGINS` environment variable to include your new frontend URL.

## 9. Compatibility Verification

The configuration provided:
-   Uses **Node.js 20** (via Nixpacks).
-   Utilizes Next.js **Standalone Output** for minimal container footprint.
-   Supports **Client-side Environment Variables** via `NEXT_PUBLIC_` prefix.
