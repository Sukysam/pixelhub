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

test("dashboard expense summary refreshes after expense create and update", async ({ page, request }) => {
  const session = await createStandardBusinessUserSession(request);
  await setSession(page, request, session.token);

  const dashboardPage = await page.context().newPage();
  await setSession(dashboardPage, request, session.token);

  await dashboardPage.goto("/");
  await expect(dashboardPage.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  const expenseCard = dashboardPage.locator("div.border.rounded-lg.p-4").filter({ has: dashboardPage.getByText("Expense") }).first();
  await expect(expenseCard).toContainText("0.00", { timeout: 30_000 });

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add Expense" }).click();
  const expenseDialog = page.locator('[role="dialog"]').filter({ hasText: "Add Expense" }).first();
  await expect(expenseDialog).toBeVisible({ timeout: 30_000 });
  await expenseDialog.locator("#exp_amount").fill("12.50");
  await expenseDialog.locator("#exp_category").fill("Travel");
  await expenseDialog.locator("#exp_cost").fill("CC-DASH");
  const createExpenseResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/expenses/") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );
  await expenseDialog.getByRole("button", { name: "Create Expense" }).click();
  await createExpenseResponse;
  await expect(page.getByText("Expense created.")).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => ((await expenseCard.textContent()) ?? "").includes("12.50"), { timeout: 30_000 })
    .toBeTruthy();

  const expenseRow = page.locator("tbody tr").filter({ hasText: "Travel" }).first();
  await expect(expenseRow).toBeVisible({ timeout: 30_000 });
  await expenseRow.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.locator('[role="dialog"]').filter({ hasText: "Edit Expense" }).first();
  await expect(editDialog).toBeVisible({ timeout: 30_000 });
  await editDialog.locator("#exp_amount").fill("18.75");
  const updateExpenseResponse = page.waitForResponse(
    (response) =>
      /\/api\/expenses\/\d+\/$/.test(response.url()) &&
      response.request().method() === "PATCH" &&
      response.status() === 200
  );
  await editDialog.getByRole("button", { name: "Save Changes" }).click();
  await updateExpenseResponse;
  await expect(page.getByText("Expense updated.")).toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => ((await expenseCard.textContent()) ?? "").includes("18.75"), { timeout: 30_000 })
    .toBeTruthy();

  await dashboardPage.close();
});

test("expenses page shows source account balances and auto-generates sequential project codes", async ({ page }) => {
  const session = await createStandardBusinessUserSession(page.request);
  await setSession(page, page.request, session.token);

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible({ timeout: 30_000 });

  const sourceAccountsTable = page.locator("table").first();
  const expensesTable = page.locator("table").nth(1);
  await expect(sourceAccountsTable.getByRole("columnheader", { name: "Current Balance" })).toBeVisible();

  const accountName = `bal_ui_${Date.now()}`;
  await page.getByRole("button", { name: "New Source Account" }).click();
  const sourceAccountDialog = page.locator('[role="dialog"]').filter({ hasText: "Create Source Account" }).first();
  await expect(sourceAccountDialog).toBeVisible({ timeout: 30_000 });
  await sourceAccountDialog.locator("#source_account_name").fill(accountName);
  await sourceAccountDialog.locator("#source_account_initial_balance").fill("250.00");
  await expect
    .poll(async () => await sourceAccountDialog.locator("#source_account_currency option").count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  const currencyValue = await sourceAccountDialog.locator("#source_account_currency option").nth(1).getAttribute("value");
  await sourceAccountDialog.locator("#source_account_currency").selectOption(currencyValue ?? "");
  const createAccountResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/source-accounts/") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );
  await sourceAccountDialog.getByRole("button", { name: "Create Account" }).click();
  const createdAccount = (await (await createAccountResponse).json()) as { id: number; currency_code: string };
  await expect(page.getByText("Source account created.")).toBeVisible({ timeout: 30_000 });

  const createdAccountRow = sourceAccountsTable.locator("tbody tr").filter({ hasText: accountName }).first();
  await expect(createdAccountRow).toBeVisible({ timeout: 30_000 });
  await expect(createdAccountRow).toContainText("250.00");

  await page.getByRole("button", { name: "Add Expense" }).click();
  const expenseDialog = page.locator('[role="dialog"]').filter({ hasText: "Add Expense" }).first();
  await expect(expenseDialog).toBeVisible({ timeout: 30_000 });
  const generatedProjectCode = await expenseDialog.locator("#exp_project").inputValue();
  expect(generatedProjectCode).toMatch(/^PRJ-\d{4}-\d{4}$/);
  await expenseDialog.locator("#exp_amount").fill("10.00");
  await expenseDialog.locator("#exp_category").fill("Office");
  await expect
    .poll(async () => await expenseDialog.locator("#exp_source_account option").count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  await expenseDialog.locator("#exp_source_account").selectOption(String(createdAccount.id));
  const createExpenseResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/expenses/") &&
      response.request().method() === "POST" &&
      response.status() === 201
  );
  await expenseDialog.getByRole("button", { name: "Create Expense" }).click();
  const createdExpense = (await (await createExpenseResponse).json()) as { project_code: string };
  expect(createdExpense.project_code).toBe(generatedProjectCode);
  await expect(page.getByText("Expense created.")).toBeVisible({ timeout: 30_000 });

  await expect(expensesTable.locator("tbody tr").first()).toContainText(generatedProjectCode);
  await expect
    .poll(async () => ((await createdAccountRow.textContent()) ?? "").includes("240.00"), { timeout: 30_000 })
    .toBeTruthy();

  await page.getByRole("button", { name: "Add Expense" }).click();
  const duplicateDialog = page.locator('[role="dialog"]').filter({ hasText: "Add Expense" }).first();
  await expect(duplicateDialog).toBeVisible({ timeout: 30_000 });
  await duplicateDialog.locator("#exp_amount").fill("5.00");
  await duplicateDialog.locator("#exp_category").fill("Office");
  await duplicateDialog.locator("#exp_project").fill(generatedProjectCode);
  await duplicateDialog.locator("#exp_source_account").selectOption(String(createdAccount.id));
  const duplicateExpenseResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/expenses/") &&
      response.request().method() === "POST" &&
      response.status() === 400
  );
  await duplicateDialog.getByRole("button", { name: "Create Expense" }).click();
  await duplicateExpenseResponse;
  await duplicateDialog.getByRole("button", { name: "Cancel" }).click();

  await expect(createdAccountRow).toContainText(createdAccount.currency_code);
  await expect
    .poll(async () => ((await createdAccountRow.textContent()) ?? "").includes("240.00"), { timeout: 30_000 })
    .toBeTruthy();
});
