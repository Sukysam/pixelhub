import { test, expect } from "@playwright/test";

test("guest can register an account", async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;
  const signupSecret = `pw_${Date.now()}A!`;

  await page.goto("/?mode=register");
  await page.getByRole("tab", { name: "Create account" }).click();

  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Company legal name").fill("E2E Company Ltd");
  await page.getByLabel(/Registration number/i).fill("RC-123456");
  await page.getByLabel("Business type / industry").selectOption("Technology");
  await page.getByLabel("Business address").fill("1 Test Street, Lagos, NG");
  await page.getByLabel("Certifications (optional)").fill("CAC");
  await page.getByLabel("Password", { exact: true }).fill(signupSecret);
  await page.getByLabel("Confirm password").fill(signupSecret);

  const questionLocator = page.locator('label[for="captcha_answer"] + div');
  await expect(questionLocator).toContainText(/\d/);
  const captchaQuestion = await questionLocator.textContent();
  expect(captchaQuestion).toBeTruthy();
  const nums = (captchaQuestion ?? "").match(/-?\d+/g)?.map((n: string) => Number(n)) ?? [];
  expect(nums.length).toBeGreaterThanOrEqual(2);
  const answer = (nums[0] + nums[1]).toString();
  await page.getByLabel("Captcha").fill(answer);

  await page.getByRole("checkbox", { name: "I agree to the terms." }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("div.w-64").getByRole("heading", { level: 1 })).toHaveText("E2E Company Ltd");
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
