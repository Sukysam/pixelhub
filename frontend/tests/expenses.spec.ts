import { test, expect } from "@playwright/test";
import { createStandardBusinessUserSession, setSession } from "./helpers/admin";

test("user can create edit and delete source accounts inside expenses", async ({ page }) => {
  const session = await createStandardBusinessUserSession(page.request);
  await setSession(page, page.request, session.token);

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Source Accounts" })).toBeVisible();

  const sourceAccountsTable = page.locator("table").first();
  const expensesTable = page.locator("table").nth(1);
  await expect(expensesTable.getByRole("columnheader", { name: "Source Account" })).toBeVisible();
  await expect(expensesTable.getByRole("columnheader", { name: "Approval" })).toHaveCount(0);
  await expect(expensesTable.getByRole("columnheader", { name: "Policy" })).toHaveCount(0);
  await expect(expensesTable.getByRole("columnheader", { name: "Receipt" })).toHaveCount(0);
  await expect(expensesTable.getByRole("columnheader", { name: "Actions" })).toHaveCount(0);

  const accountName = `petty_ui_${Date.now()}`;
  const createSourceAccountButton = page.getByRole("button", { name: "New Source Account" });
  await expect(createSourceAccountButton).toBeEnabled({ timeout: 30_000 });
  await createSourceAccountButton.click();
  const sourceAccountDialog = page.locator('[role="dialog"]').filter({ hasText: "Create Source Account" }).first();
  await expect(sourceAccountDialog).toBeVisible({ timeout: 30_000 });
  await sourceAccountDialog.locator("#source_account_name").fill(accountName);
  await sourceAccountDialog.locator("#source_account_initial_balance").fill("250.00");
  await expect
    .poll(async () => await sourceAccountDialog.locator("#source_account_currency option").count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  const currencyValue = await sourceAccountDialog.locator("#source_account_currency option").nth(1).getAttribute("value");
  await sourceAccountDialog.locator("#source_account_currency").selectOption(currencyValue ?? "");
  let createdAccountResponse = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const createAccountResponse = page.waitForResponse(
      (response) => response.url().includes("/api/source-accounts/") && response.request().method() === "POST"
    );
    await sourceAccountDialog.getByRole("button", { name: "Create Account" }).click();
    const response = await createAccountResponse;
    if (response.status() === 201) {
      createdAccountResponse = response;
      break;
    }
    await expect(page.getByText("Unable to create sourceaccount. Please try again.")).toBeVisible({ timeout: 30_000 });
  }
  expect(createdAccountResponse).toBeTruthy();
  if (!createdAccountResponse) throw new Error("Source account creation did not succeed after retries.");
  const createdAccount = (await createdAccountResponse.json()) as { id: number; name: string };
  await expect(page.getByText("Source account created.")).toBeVisible({ timeout: 30_000 });
  const createdAccountRow = sourceAccountsTable.locator("tbody tr").filter({ hasText: accountName }).first();
  await expect(createdAccountRow).toBeVisible();

  await page.getByRole("button", { name: "Add Expense" }).click();
  const expenseDialog = page.locator('[role="dialog"]').filter({ hasText: "Add Expense" }).first();
  await expect(expenseDialog).toBeVisible({ timeout: 30_000 });
  await expenseDialog.locator("#exp_amount").fill("10.00");
  await expenseDialog.locator("#exp_category").fill("Office");
  await expenseDialog.locator("#exp_project").fill("PROJECT-UI");
  await expect
    .poll(async () => await expenseDialog.locator("#exp_source_account option").count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  await expenseDialog.locator("#exp_source_account").selectOption(String(createdAccount.id));
  await expect(expenseDialog.locator("#exp_source_account")).toHaveValue(String(createdAccount.id));

  const createExpenseResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/expenses/") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );
  await expenseDialog.getByRole("button", { name: "Create Expense" }).click();
  await createExpenseResponse;

  await expect(page.getByText("Expense created.")).toBeVisible({ timeout: 30_000 });
  const expenseRow = expensesTable.locator("tbody tr").first();
  await expect(expenseRow).toContainText(accountName);

  await createdAccountRow.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.locator('[role="dialog"]').filter({ hasText: "Edit Source Account" }).first();
  await expect(editDialog).toBeVisible({ timeout: 30_000 });
  const updatedAccountName = `${accountName}_upd`;
  await editDialog.locator("#source_account_name").fill(updatedAccountName);
  const updateAccountResponse = page.waitForResponse(
    (response) =>
      /\/api\/source-accounts\/\d+\/$/.test(response.url()) &&
      response.request().method() === "PATCH" &&
      response.status() === 200
  );
  await editDialog.getByRole("button", { name: "Save Account" }).click();
  await updateAccountResponse;
  await expect(page.getByText("Source account updated.")).toBeVisible({ timeout: 30_000 });
  await expect(sourceAccountsTable.locator("tbody tr").filter({ hasText: updatedAccountName }).first()).toBeVisible();

  const updatedAccountRow = sourceAccountsTable.locator("tbody tr").filter({ hasText: updatedAccountName }).first();
  await updatedAccountRow.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.locator('[role="dialog"]').filter({ hasText: "Delete Source Account" }).first();
  await expect(deleteDialog).toBeVisible({ timeout: 30_000 });
  await expect(deleteDialog).toContainText("Historical expenses remain linked");
  await deleteDialog.locator('input[type="checkbox"]').check();
  const deleteAccountResponse = page.waitForResponse(
    (response) =>
      /\/api\/source-accounts\/\d+\/$/.test(response.url()) &&
      response.request().method() === "DELETE" &&
      response.status() === 200
  );
  await deleteDialog.getByRole("button", { name: "Delete Source Account" }).click();
  await deleteAccountResponse;
  await expect(page.getByText("Source account deleted.")).toBeVisible({ timeout: 30_000 });
  await expect(sourceAccountsTable.locator("tbody tr").filter({ hasText: updatedAccountName })).toHaveCount(0);
  await expect(expensesTable.locator("tbody tr").first()).toContainText(updatedAccountName);
  await expect(expensesTable.locator("tbody tr").first()).toContainText("Closed");
});
