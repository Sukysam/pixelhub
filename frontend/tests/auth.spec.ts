import { test, expect } from "@playwright/test";
import {
  API_BASE_URL,
  adminInvitationTokenForEmail,
  adminInvitationUrlForEmail,
  createAdminInvitedUser,
  expireAdminInvitationForEmail,
} from "./helpers/admin";

function uniqueNgPhone() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9);
  return `8${suffix}`;
}

async function fillRegistrationForm(page: any, email: string, password: string, phoneNumber = uniqueNgPhone()) {
  await page.goto("/register");

  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Create New Password (6 Characters Minimum)").fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByLabel("Your Company Name").fill("E2E Company Ltd");
  await page.getByLabel("Phone Number").fill(phoneNumber);
}

test("guest can register an account on desktop without captcha", async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;
  const signupSecret = `pw_${Date.now()}A!`;

  await page.goto("/?mode=login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Facebook" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
  await expect(page.getByText("Need a different portal?")).toHaveCount(0);
  await expect(page.getByText("Administrative sign-in is separated from the standard user login.")).toHaveCount(0);

  await fillRegistrationForm(page, email, signupSecret);
  await expect(page.getByLabel("Captcha")).toHaveCount(0);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(/Account created successfully/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Go to login" })).toBeVisible();
});

test("removed standalone admin portal routes return not found", async ({ page }) => {
  for (const path of ["/admin-login", "/staff-login", "/admin/settings", "/admin/users"]) {
    const res = await page.request.get(path);
    expect(res.status(), `${path} should not be reachable`).toBe(404);
  }
});

test("signup validation works on mobile-sized viewport without broken captcha UI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `e2e_mobile_${Date.now()}@example.com`;

  await fillRegistrationForm(page, email, "weak");
  await expect(page.getByLabel("Captcha")).toHaveCount(0);
  await page.getByRole("checkbox").check();

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/Password must be at least 6 characters/i)).toBeVisible();
  await expect(page.getByText(/or sign up with email/i)).toBeVisible();
});

test("guest can request password reset", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();

  const email = `e2e_reset_${Date.now()}@example.com`;
  const emailInput = page.getByLabel("Email");
  await emailInput.fill(email);
  await expect(emailInput).toHaveValue(email);
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText(/password reset link has been sent/i)).toBeVisible({ timeout: 30_000 });
});

test("admin invited user accepts invitation, sets a password, and reaches the dashboard", async ({ page, request }) => {
  test.slow();
  const invited = await createAdminInvitedUser(request, {
    email: `e2e_invite_success_${Date.now()}@example.com`,
    companyName: "Invite Success Co",
    fullName: "Invite Success User",
  });

  const preLoginRes = await request.post(`${API_BASE_URL}/auth/token/`, {
    data: { username: invited.username, password: invited.password, remember: true },
  });
  expect(preLoginRes.ok()).toBeFalsy();
  expect(await preLoginRes.text()).toMatch(/invitation pending|not active/i);

  await page.goto(adminInvitationUrlForEmail(invited.email));
  await page.waitForURL(/\/reset-password\?/i, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();

  const newPassword = `Invite_${Date.now()}Aa!`;
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });

  const postLoginRes = await request.post(`${API_BASE_URL}/auth/token/`, {
    data: { username: invited.username, password: newPassword, remember: true },
  });
  expect(postLoginRes.ok()).toBeTruthy();
  const postLogin = (await postLoginRes.json()) as { token: string };

  const meRes = await request.get(`${API_BASE_URL}/auth/me/`, {
    headers: { Authorization: `Token ${postLogin.token}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const me = (await meRes.json()) as { email?: string; roles?: string[]; permissions?: string[] };
  expect(me.email).toBe(invited.email);
  expect(me.roles ?? []).toContain("editor");
  expect(me.permissions ?? []).toContain("data.customers.write");
  expect(me.permissions ?? []).toContain("data.invoices.write");
  expect(me.permissions ?? []).toContain("data.receipts.write");
});

test("password reset remains gated until the admin invitation is accepted", async ({ request }) => {
  const invited = await createAdminInvitedUser(request, {
    email: `e2e_invite_gate_${Date.now()}@example.com`,
    companyName: "Invite Gate Co",
    fullName: "Invite Gate User",
  });

  const resetBeforeAcceptanceRes = await request.post(`${API_BASE_URL}/auth/password-reset/`, {
    data: { email: invited.email },
  });
  expect(resetBeforeAcceptanceRes.ok()).toBeTruthy();
  expect((await resetBeforeAcceptanceRes.json()) as { sent?: boolean }).toEqual({ sent: true });

  const blockedLoginRes = await request.post(`${API_BASE_URL}/auth/token/`, {
    data: { username: invited.username, password: invited.password, remember: true },
  });
  expect(blockedLoginRes.ok()).toBeFalsy();
  expect(await blockedLoginRes.text()).toMatch(/invitation pending|not active/i);

  const acceptRes = await request.post(`${API_BASE_URL}/auth/verify-email/`, {
    data: { token: adminInvitationTokenForEmail(invited.email), token_type: "admin_invitation" },
  });
  expect(acceptRes.ok()).toBeTruthy();
  const accepted = (await acceptRes.json()) as {
    invitation_accepted?: boolean;
    password_reset_unlocked?: boolean;
    reset_uid?: string;
    reset_token?: string;
  };
  expect(accepted.invitation_accepted).toBeTruthy();
  expect(accepted.password_reset_unlocked).toBeTruthy();
  expect(accepted.reset_uid).toBeTruthy();
  expect(accepted.reset_token).toBeTruthy();
});

test("expired admin invitation shows a verification error", async ({ page, request }) => {
  const invited = await createAdminInvitedUser(request, {
    email: `e2e_invite_expired_${Date.now()}@example.com`,
    companyName: "Invite Expired Co",
    fullName: "Invite Expired User",
  });

  const expiredToken = expireAdminInvitationForEmail(invited.email);
  await page.goto(`/verify-email?token=${encodeURIComponent(expiredToken)}&token_type=admin_invitation`);

  await expect(page.getByRole("heading", { name: "Verify email" })).toBeVisible();
  await expect(page.getByText(/expired/i)).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/verify-email\?/i);
});
