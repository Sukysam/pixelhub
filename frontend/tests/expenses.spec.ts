import { test, expect } from "@playwright/test";
import { createStandardBusinessUserSession, setSession } from "./helpers/admin";

test("expenses UI removes approval/policy/receipt actions and shows source account", async ({ page }) => {
  const session = await createStandardBusinessUserSession(page.request);
  await setSession(page, page.request, session.token);

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible({ timeout: 30_000 });

  const table = page.locator("table").first();
  await expect(table.getByRole("columnheader", { name: "Source Account" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Approval" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Policy" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Receipt" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Actions" })).toHaveCount(0);

  await page.getByRole("button", { name: "Add Expense" }).click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: "Add Expense" }).first();
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  await dialog.locator("#exp_amount").fill("10.00");
  await dialog.locator("#exp_category").fill("Office");
  await dialog.locator("#exp_project").fill("PROJECT-UI");
  await dialog.locator("#exp_source_account").fill("petty1");

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/expenses/") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );
  await dialog.getByRole("button", { name: "Create Expense" }).click();
  await createResponse;

  await expect(page.getByText("Expense created.")).toBeVisible({ timeout: 30_000 });
  await expect(table.locator("tbody tr").first()).toContainText("petty1");
});

