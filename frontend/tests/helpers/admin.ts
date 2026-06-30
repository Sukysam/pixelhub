import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000/api";
export const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const REPO_ROOT = path.resolve(process.cwd(), "..");
const FRONTEND_BASE_URL = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

let cachedAdminTokenValue: string | null = null;
const ADMIN_TOKEN_CACHE_PATH = path.join(os.tmpdir(), "pixelhub-e2e-admin-token.json");
const ADMIN_TOKEN_LOCK_PATH = `${ADMIN_TOKEN_CACHE_PATH}.lock`;

type MePayload = { roles?: string[]; permissions?: string[]; email?: string };
type AdminCredentials = { username: string; password: string };
type CreateInvitedUserOptions = {
  email?: string;
  username?: string;
  password?: string;
  companyName?: string;
  fullName?: string;
  phone?: string;
  primaryRole?: string;
  customRoles?: string[];
};

type InvitedUserSessionSeed = {
  email: string;
  username: string;
  password: string;
  phone: string;
  primaryRole: string;
  customRoles: string[];
  adminAccessToken: string;
  clientIp: string;
};

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function validateToken(request: APIRequestContext, token: string): Promise<boolean> {
  const res = await request.get(`${API_BASE_URL}/auth/me/`, {
    headers: { Authorization: `Token ${token}` },
  });
  return res.ok();
}

function readCachedTokenFromDisk(): string | null {
  try {
    const raw = fs.readFileSync(ADMIN_TOKEN_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed.token ? String(parsed.token) : null;
  } catch {
    return null;
  }
}

function writeCachedTokenToDisk(token: string) {
  fs.writeFileSync(ADMIN_TOKEN_CACHE_PATH, JSON.stringify({ token }), "utf-8");
}

function isLocalApiBaseUrl() {
  try {
    const parsed = new URL(API_BASE_URL);
    return /^(127\.0\.0\.1|localhost)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function pythonCandidates() {
  return [
    path.join(REPO_ROOT, ".ci-venv", "bin", "python"),
    path.join(REPO_ROOT, "venv", "bin", "python"),
    process.env.PYTHON_BIN ?? "",
    "python3",
  ].filter(Boolean);
}

function runManagePy(script: string): string {
  if (!isLocalApiBaseUrl()) {
    throw new Error("Local manage.py helpers are only available when Playwright targets a local backend.");
  }

  let lastError: unknown = null;
  for (const candidate of pythonCandidates()) {
    try {
      return String(
        execFileSync(candidate, ["manage.py", "shell", "-c", script], {
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf-8",
        })
      ).trim();
    } catch (error) {
      lastError = error;
    }
  }

  const message =
    lastError instanceof Error && lastError.message
      ? lastError.message
      : String(lastError ?? "unknown manage.py failure");
  throw new Error(`Unable to execute manage.py helper: ${message}`);
}

function bootstrapLocalAdminCredentials(): AdminCredentials {
  if (!isLocalApiBaseUrl()) {
    throw new Error("E2E_USERNAME and E2E_PASSWORD are required when running Playwright against a non-local backend.");
  }

  const username = "pixelhub_e2e_admin";
  const password = `pw_${crypto.createHash("sha256").update(REPO_ROOT).digest("hex").slice(0, 18)}A!`;
  const script = [
    "from django.contrib.auth import get_user_model",
    "User = get_user_model()",
    `username = ${JSON.stringify(username)}`,
    `password = ${JSON.stringify(password)}`,
    "user, _ = User.objects.get_or_create(username=username, defaults={'email': username, 'is_active': True})",
    "user.email = username",
    "user.is_active = True",
    "user.is_staff = True",
    "user.is_superuser = True",
    "user.set_password(password)",
    "user.save(update_fields=['email', 'is_active', 'is_staff', 'is_superuser', 'password'])",
    "print(username)",
  ].join("; ");

  runManagePy(script);
  return { username, password };
}

function getAdminCredentials(): AdminCredentials {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (username && password) return { username, password };
  return bootstrapLocalAdminCredentials();
}

export async function adminToken(request: APIRequestContext) {
  if (cachedAdminTokenValue) return cachedAdminTokenValue;

  const diskToken = readCachedTokenFromDisk();
  if (diskToken && (await validateToken(request, diskToken))) {
    cachedAdminTokenValue = diskToken;
    return cachedAdminTokenValue;
  }

  let lockFd: number | null = null;
  for (let lockAttempt = 0; lockAttempt < 20; lockAttempt += 1) {
    try {
      lockFd = fs.openSync(ADMIN_TOKEN_LOCK_PATH, "wx");
      break;
    } catch {
      const waitingToken = readCachedTokenFromDisk();
      if (waitingToken && (await validateToken(request, waitingToken))) {
        cachedAdminTokenValue = waitingToken;
        return cachedAdminTokenValue;
      }
      await delay(250);
    }
  }
  if (lockFd == null) {
    throw new Error("Admin login failed: unable to acquire shared token lock");
  }

  try {
    const freshDiskToken = readCachedTokenFromDisk();
    if (freshDiskToken && (await validateToken(request, freshDiskToken))) {
      cachedAdminTokenValue = freshDiskToken;
      return cachedAdminTokenValue;
    }

    const { username, password } = getAdminCredentials();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loginRes = await request.post(`${API_BASE_URL}/auth/token/`, { data: { username, password, remember: true } });
      if (loginRes.ok()) {
        const login = (await loginRes.json()) as { token: string };
        cachedAdminTokenValue = login.token;
        writeCachedTokenToDisk(login.token);
        return cachedAdminTokenValue;
      }
      const body = await loginRes.text();
      if (loginRes.status() === 429 && attempt < 3) {
        await delay(500 * (attempt + 1));
        continue;
      }
      throw new Error(`Admin login failed: status=${loginRes.status()} body=${body}`);
    }
    throw new Error("Admin login failed after retries");
  } finally {
    if (lockFd != null) fs.closeSync(lockFd);
    try {
      fs.unlinkSync(ADMIN_TOKEN_LOCK_PATH);
    } catch {
      // ignore lock cleanup races
    }
  }
}

export async function setSession(page: Page, request: APIRequestContext, token: string) {
  const meRes = await request.get(`${API_BASE_URL}/auth/me/`, { headers: { Authorization: `Token ${token}` } });
  expect(meRes.ok()).toBeTruthy();
  const me = await meRes.json();

  await page.addInitScript(
    (payload: { t: string; u: unknown }) => {
      window.localStorage.setItem("auth_token", String(payload.t));
      window.localStorage.setItem("auth_user", JSON.stringify(payload.u));
    },
    { t: token, u: me }
  );
}

export function uniqueNgPhone(): string {
  const digits = crypto.randomBytes(6).toString("hex").replace(/\D/g, "").padEnd(9, "0").slice(0, 9);
  return `8${digits}`;
}

function uniqueTestIp(): string {
  const bytes = crypto.randomBytes(3);
  return `203.${bytes[0]}.${bytes[1]}.${bytes[2]}`;
}

export async function createAdminInvitedUser(request: APIRequestContext, options: CreateInvitedUserOptions = {}) {
  const token = await adminToken(request);
  const email = options.email ?? `e2e_invited_${Date.now()}_${crypto.randomBytes(3).toString("hex")}@example.com`;
  const username = options.username ?? email;
  const password = options.password ?? `pw_${crypto.randomBytes(8).toString("hex")}A!`;
  const phone = options.phone ?? uniqueNgPhone();
  const primaryRole = options.primaryRole ?? "user";
  const customRoles = options.customRoles ?? [];
  const clientIp = uniqueTestIp();

  const createRes = await request.post(`${API_BASE_URL}/admin/users/`, {
    headers: { Authorization: `Token ${token}`, "x-forwarded-for": clientIp },
    data: {
      username,
      email,
      password,
      company_name: options.companyName ?? "E2E Business Co",
      full_name: options.fullName ?? "E2E Invited User",
      phone,
      is_active: false,
      primary_role: primaryRole,
      custom_roles: customRoles,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const payload = (await createRes.json()) as { invitation_sent?: boolean };
  expect(payload.invitation_sent).toBeTruthy();

  return { email, username, password, phone, primaryRole, customRoles, adminAccessToken: token, clientIp };
}

export function adminInvitationTokenForEmail(email: string): string {
  const script = [
    "from django.contrib.auth import get_user_model",
    "from core.models import AdminUserInvitation",
    "from core.views import _sign_admin_invitation",
    "User = get_user_model()",
    `email = ${JSON.stringify(String(email).trim().toLowerCase())}`,
    "user = User.objects.get(email=email)",
    "invitation = AdminUserInvitation.objects.get(user=user)",
    "print(_sign_admin_invitation(invitation))",
  ].join("; ");
  return runManagePy(script);
}

export function adminInvitationUrlForEmail(email: string): string {
  const token = adminInvitationTokenForEmail(email);
  return `${FRONTEND_BASE_URL}/verify-email?token=${encodeURIComponent(token)}&token_type=admin_invitation`;
}

export function expireAdminInvitationForEmail(email: string): string {
  const script = [
    "from datetime import timedelta",
    "from django.contrib.auth import get_user_model",
    "from django.utils import timezone",
    "from core.models import AdminUserInvitation",
    "from core.views import _sign_admin_invitation",
    "User = get_user_model()",
    `email = ${JSON.stringify(String(email).trim().toLowerCase())}`,
    "user = User.objects.get(email=email)",
    "invitation = AdminUserInvitation.objects.get(user=user)",
    "invitation.expires_at = timezone.now() - timedelta(minutes=1)",
    "invitation.save(update_fields=['expires_at', 'updated_at'])",
    "print(_sign_admin_invitation(invitation))",
  ].join("; ");
  return runManagePy(script);
}

export async function completeAdminInvitationOnboarding(
  request: APIRequestContext,
  invited: Pick<InvitedUserSessionSeed, "email" | "clientIp">,
  newPassword: string
) {
  const invitationToken = adminInvitationTokenForEmail(invited.email);
  const acceptRes = await request.post(`${API_BASE_URL}/auth/verify-email/`, {
    headers: { "x-forwarded-for": invited.clientIp },
    data: { token: invitationToken, token_type: "admin_invitation" },
  });
  expect(acceptRes.ok()).toBeTruthy();
  const accepted = (await acceptRes.json()) as { reset_uid: string; reset_token: string };

  const confirmRes = await request.post(`${API_BASE_URL}/auth/password-reset-confirm/`, {
    headers: { "x-forwarded-for": invited.clientIp },
    data: {
      uid: accepted.reset_uid,
      token: accepted.reset_token,
      new_password: newPassword,
      new_password_confirm: newPassword,
      remember: true,
    },
  });
  expect(confirmRes.ok()).toBeTruthy();
  return (await confirmRes.json()) as { token: string; activated?: boolean; activation_email_sent?: boolean };
}

export async function createStandardBusinessUserSession(request: APIRequestContext) {
  const invited = await createAdminInvitedUser(request);
  const password = `pw_${crypto.randomBytes(8).toString("hex")}A!`;
  const onboarding = await completeAdminInvitationOnboarding(request, invited, password);

  const meRes = await request.get(`${API_BASE_URL}/auth/me/`, {
    headers: { Authorization: `Token ${onboarding.token}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const me = (await meRes.json()) as MePayload;
  expect(me.roles ?? []).toContain("editor");
  expect(me.permissions ?? []).toContain("data.customers.write");
  expect(me.permissions ?? []).toContain("data.invoices.write");
  expect(me.permissions ?? []).toContain("data.receipts.write");

  return { email: invited.email, password, token: onboarding.token, me };
}
