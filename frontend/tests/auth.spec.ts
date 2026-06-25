import { test, expect } from "@playwright/test";

async function fillRegistrationForm(page: any, email: string, password: string) {
  await page.goto("/register");

  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Create New Password (6 Characters Minimum)").fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByLabel("Your Company Name").fill("E2E Company Ltd");
  await page.getByLabel("Phone Number").fill("8012345678");
}

test("guest can register an account on desktop without captcha", async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;
  const signupSecret = `pw_${Date.now()}A!`;

  await page.goto("/?mode=login");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Facebook" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);

  await fillRegistrationForm(page, email, signupSecret);
  await expect(page.getByLabel("Captcha")).toHaveCount(0);

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(/Account created successfully/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Go to login" })).toBeVisible();
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
