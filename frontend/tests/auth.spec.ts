import { test, expect } from "@playwright/test";

async function fillRegistrationForm(page: any, email: string, password: string) {
  await page.goto("/?mode=register");
  await page.getByRole("tab", { name: "Create account" }).click();

  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Company legal name").fill("E2E Company Ltd");
  await page.getByLabel(/Registration number/i).fill("RC-123456");
  await page.getByLabel("Business type / industry").selectOption("Technology");
  await page.getByLabel("Business address").fill("1 Test Street, Lagos, NG");
  await page.getByLabel("Certifications (optional)").fill("CAC");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
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

  await page.getByRole("checkbox", { name: "I agree to the terms." }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("div.w-64").getByRole("heading", { level: 1 })).toHaveText("E2E Company Ltd");
});

test("signup validation works on mobile-sized viewport without broken captcha UI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `e2e_mobile_${Date.now()}@example.com`;

  await fillRegistrationForm(page, email, "weak");
  await expect(page.getByLabel("Captcha")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "I agree to the terms." }).check();

  await expect(page.getByText(/Password must include:/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  await expect(page.getByRole("tabpanel", { name: "Registration form" })).toBeVisible();
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
