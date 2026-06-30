import { test, expect } from "@playwright/test";
import crypto from "crypto";
import {
  API_BASE_URL,
  BACKEND_ORIGIN,
  adminToken,
  createStandardBusinessUserSession,
  setSession,
  uniqueNgPhone,
} from "./helpers/admin";

async function getJson(request: any, token: string, apiPath: string) {
  const res = await request.get(`${API_BASE_URL}${apiPath}`, {
    headers: { Authorization: `Token ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function waitForUploadedLogoSrc(locator: any) {
  await expect.poll(async () => (await locator.getAttribute("src")) ?? "", { timeout: 30_000 }).toContain("/media/uploads/logos/");
  return (await locator.getAttribute("src")) ?? "";
}

function png1x1(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n6nQAAAAASUVORK5CYII=",
    "base64"
  );
}

function jpg1x1(): Buffer {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
    "base64"
  );
}

function safeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0ea5e9"/><text x="8" y="36" font-size="18" fill="#fff">LOGO</text></svg>`;
}

async function registerAndReachDashboard(page: any) {
  const session = await createStandardBusinessUserSession(page.request);
  await setSession(page, page.request, session.token);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
  return session;
}

test("standard user settings does not expose administration controls", async ({ page }) => {
  await registerAndReachDashboard(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
});

test("admin can manage roles and users from settings", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Permission Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();

  const roleName = `ops_ui_${Date.now()}`;
  await page.getByRole("button", { name: "New Role" }).click();
  const roleDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Create Role" }) });
  await roleDialog.getByLabel("Role Name").fill(roleName);
  await roleDialog.getByLabel("Description").fill("Operations role created from settings UI");
  await roleDialog.locator("label").filter({ hasText: "data.items.read" }).locator('input[type="checkbox"]').check();
  await roleDialog.getByRole("button", { name: "Create role" }).evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.getByText("Role created successfully.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(roleName)).toBeVisible();

  const email = `settings_admin_${Date.now()}@example.com`;
  const phone = uniqueNgPhone();
  await page.getByRole("button", { name: "New User" }).click();
  const userDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Create User" }) });
  await userDialog.getByLabel("Username").fill(email);
  await userDialog.getByLabel("Email").fill(email);
  await userDialog.getByLabel("Full Name").fill("Settings Admin User");
  await userDialog.getByLabel("Company Name").fill("Settings Admin Co");
  await userDialog.getByLabel("Phone").fill(phone);
  await userDialog.getByLabel("Primary Role").selectOption("user");
  const userPassword = "pw_settings_ui_A1!";
  await userDialog.getByPlaceholder("Minimum 6 characters").fill(userPassword);
  const customRoleCheckbox = userDialog.locator("label").filter({ hasText: roleName }).locator('input[type="checkbox"]').first();
  await customRoleCheckbox.evaluate((node: HTMLInputElement) => node.click());
  await userDialog.getByRole("button", { name: "Create user" }).evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.getByText("User created and invitation email sent.")).toBeVisible({ timeout: 30_000 });

  const createdUsersRes = await request.get(`${API_BASE_URL}/admin/users/?page=1`, {
    headers: { Authorization: `Token ${token}` },
  });
  expect(createdUsersRes.ok()).toBeTruthy();
  const createdUsers = (await createdUsersRes.json()) as {
    count: number;
    results: Array<{ email?: string; custom_roles?: string[]; invitation_status?: string; is_active?: boolean }>;
  };
  const finalPage = Math.max(1, Math.ceil(createdUsers.count / 25));
  const pageToInspect =
    finalPage === 1
      ? createdUsers
      : ((await (
          await request.get(`${API_BASE_URL}/admin/users/?page=${finalPage}`, {
            headers: { Authorization: `Token ${token}` },
          })
        ).json()) as typeof createdUsers);
  const createdUser = pageToInspect.results.find((row) => row.email === email);
  expect(createdUser).toBeTruthy();
  expect(createdUser?.custom_roles ?? []).toContain(roleName);
  expect(createdUser?.invitation_status).toBe("pending_acceptance");
  expect(createdUser?.is_active).toBeFalsy();
});

test("user can update invoice footer in settings", async ({ page }) => {
  const session = await registerAndReachDashboard(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected Accounts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true }).first()).toBeVisible();

  const footer = page.getByLabel("Invoice Footer Text");
  const newValue = `E2E Footer ${Date.now()}`;
  await expect(footer).toBeVisible({ timeout: 30_000 });
  await footer.fill(newValue);

  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Settings updated.")).toBeVisible();
  await expect(footer).toHaveValue(newValue);
  await expect(page.getByText(newValue)).toBeVisible();

  const savedSettings = (await getJson(page.request, session.token, "/settings/me/")) as {
    invoice_template: { footer_text?: string | null };
  };
  expect(savedSettings.invoice_template.footer_text).toBe(newValue);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Invoice Footer Text")).toHaveValue(newValue);
  await expect(page.getByLabel("Invoice preview")).toContainText(newValue);
});

test("user can select NGN currency in settings", async ({ page, request }) => {
  const session = await registerAndReachDashboard(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const currency = page.getByLabel("Currency");
  await expect(currency).toBeVisible({ timeout: 30_000 });
  await currency.selectOption({ label: "NGN (₦)" });

  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(currency).toHaveValue(/^\d+$/);
  await expect(page.getByLabel("Invoice preview")).toContainText(/NGN|₦/);

  const effective = (await getJson(request, session.token, "/settings/effective/")) as {
    effective: { currency_code: string };
  };
  expect(effective.effective.currency_code).toBe("NGN");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Currency")).toHaveValue(await currency.inputValue());
  await expect(page.getByLabel("Invoice preview")).toContainText(/NGN|₦/);
});

test("standard business user can persist customer invoice and receipt records", async ({ page, request }) => {
  test.slow();
  const session = await registerAndReachDashboard(page);
  const authHeaders = { Authorization: `Token ${session.token}` };
  const suffix = `${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
  const customerName = `E2E Customer ${suffix}`;
  const customerEmail = `customer_${suffix}@example.com`;
  const customerPhone = "08011112222";
  const customerAddress = `12 Persistence Street ${suffix}`;
  const updatedCustomerAddress = `24 Updated Avenue ${suffix}`;

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await page.getByRole("button", { name: "Add Customer" }).click();
  const customerDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add New Customer" }) });
  await customerDialog.getByLabel("Name").fill(customerName);
  await customerDialog.getByLabel("Email").fill(customerEmail);
  await customerDialog.getByLabel("Phone").fill(customerPhone);
  await customerDialog.getByLabel("Billing Address").fill(customerAddress);
  await customerDialog.getByRole("button", { name: "Add Customer" }).click();
  await expect(page.getByText(customerName)).toBeVisible({ timeout: 30_000 });

  const customersAfterCreate = (await getJson(request, session.token, "/customers/?page=1")) as {
    results: Array<{ id: number; name: string; billing_address?: string | null }>;
  };
  const createdCustomer = customersAfterCreate.results.find((row) => row.name === customerName);
  expect(createdCustomer).toBeTruthy();
  expect(createdCustomer?.billing_address).toBe(customerAddress);

  const customerRow = page.locator("tbody tr", { hasText: customerName }).first();
  await customerRow.getByRole("button", { name: "Edit" }).click();
  const customerEditRow = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: "Save" }) }).first();
  await customerEditRow.locator("input").last().fill(updatedCustomerAddress);
  await customerEditRow.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(customerRow).toContainText(updatedCustomerAddress, { timeout: 30_000 });

  const customersAfterUpdate = (await getJson(request, session.token, "/customers/?page=1")) as {
    results: Array<{ id: number; name: string; billing_address?: string | null }>;
  };
  const updatedCustomer = customersAfterUpdate.results.find((row) => row.name === customerName);
  expect(updatedCustomer?.billing_address).toBe(updatedCustomerAddress);

  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: authHeaders,
    data: {
      name: `E2E Widget ${suffix}`,
      unit_price: "30.00",
      tax_rate: "0",
      stock_quantity: 8,
    },
  });
  expect(itemRes.ok()).toBeTruthy();
  const item = (await itemRes.json()) as { id: number; name: string };

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Create Invoice" })).toBeVisible();
  const invoiceCustomerSelect = page.locator("select").first();
  const invoiceCustomerValue = await invoiceCustomerSelect.locator('option[value]:not([value=""])').first().getAttribute("value");
  expect(invoiceCustomerValue).toBeTruthy();
  await invoiceCustomerSelect.selectOption(invoiceCustomerValue!);
  await page.getByRole("button", { name: "Add Item" }).click();
  const pickerDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Select Item" }) });
  await expect(pickerDialog).toBeVisible();
  await pickerDialog.getByRole("button", { name: new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  const invoiceLineItemRow = page.locator("tr").filter({ has: page.getByRole("button", { name: new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }) }).first();
  await expect(invoiceLineItemRow).toBeVisible();
  await invoiceLineItemRow.locator('input[type="number"]').nth(1).fill("1");
  await page.getByLabel("Discount Type").selectOption("percentage");
  await page.getByLabel("Discount (%)").fill("10");
  await expect(page.getByText(/Discount \(Percentage 10%\)/)).toBeVisible();
  await page.getByRole("button", { name: "Save Invoice" }).click();
  const summaryDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Invoice Summary" }) });
  await expect(summaryDialog).toBeVisible({ timeout: 30_000 });
  await expect(summaryDialog).toContainText("Discount (Percentage 10%)");
  await summaryDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Invoice .* saved\./)).toBeVisible({ timeout: 30_000 });
  const newestInvoiceRow = page.locator("tr").filter({ hasText: /INV-\d{4}-\d+/ }).first();
  await expect(newestInvoiceRow).toBeVisible({ timeout: 30_000 });
  const createdInvoiceNumber = ((await newestInvoiceRow.textContent()) || "").match(/INV-\d{4}-\d+/)?.[0];
  expect(createdInvoiceNumber).toBeTruthy();

  const invoicesAfterCreate = (await getJson(request, session.token, "/invoices/?page=1")) as {
    results: Array<{ id: number; invoice_number: string; status: string }>;
  };
  const createdInvoice = invoicesAfterCreate.results.find((row) => row.invoice_number === createdInvoiceNumber);
  expect(createdInvoice).toBeTruthy();
  expect(createdInvoice?.status).toBe("Draft");

  const invoiceRow = page.locator("tbody tr", { hasText: createdInvoiceNumber ?? "" }).first();
  await invoiceRow.getByRole("button", { name: "Edit" }).click();
  await invoiceRow.locator("select").first().selectOption("Sent");
  await invoiceRow.locator('input[type="date"]').fill("2026-07-31");
  const invoiceUpdateResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_BASE_URL}/invoices/${createdInvoice?.id}/` &&
      response.request().method() === "PATCH" &&
      response.status() === 200
  );
  await invoiceRow.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await invoiceUpdateResponse;
  await expect(invoiceRow).toContainText("Sent", { timeout: 30_000 });

  const invoiceDetailRes = await request.get(`${API_BASE_URL}/invoices/${createdInvoice?.id}/`, {
    headers: authHeaders,
  });
  expect(invoiceDetailRes.ok()).toBeTruthy();
  const updatedInvoice = (await invoiceDetailRes.json()) as {
    status: string;
    due_date?: string | null;
    discount_type: "percentage" | "fixed";
    discount_value: string;
    discount_amount: string;
    total_amount: string;
  };
  expect(updatedInvoice.status).toBe("Sent");
  expect(updatedInvoice.due_date).toBe("2026-07-31");
  expect(updatedInvoice.discount_type).toBe("percentage");
  expect(updatedInvoice.discount_value).toBe("10.00");
  expect(updatedInvoice.discount_amount).toBe("3.00");
  expect(updatedInvoice.total_amount).toBe("27.00");

  await invoiceRow.getByRole("button", { name: "Edit" }).click();
  await invoiceRow.locator("select").nth(1).selectOption("fixed");
  await invoiceRow.locator('input[type="number"]').last().fill("5");
  const invoiceDiscountUpdateResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_BASE_URL}/invoices/${createdInvoice?.id}/` &&
      response.request().method() === "PATCH" &&
      response.status() === 200
  );
  await invoiceRow.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await invoiceDiscountUpdateResponse;
  await expect(invoiceRow).toContainText("Fixed amount", { timeout: 30_000 });

  const invoiceAfterDiscountRes = await request.get(`${API_BASE_URL}/invoices/${createdInvoice?.id}/`, {
    headers: authHeaders,
  });
  expect(invoiceAfterDiscountRes.ok()).toBeTruthy();
  const invoiceAfterDiscount = (await invoiceAfterDiscountRes.json()) as { total_amount: string };
  const amountToPay = invoiceAfterDiscount.total_amount;

  await page.goto("/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();
  await page.getByRole("button", { name: "Record Payment" }).click();
  const paymentDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Make Payment" }) });
  await paymentDialog.getByLabel("Invoice").selectOption(String(createdInvoice?.id));
  await paymentDialog.getByLabel("Amount Paid").fill(amountToPay);
  await paymentDialog.getByLabel("Transaction Date").fill("2026-07-01");
  await paymentDialog.getByLabel("Payment Method").selectOption("Cash");
  await paymentDialog.getByRole("button", { name: "Process Payment" }).click();
  const confirmPaymentDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Confirm Payment" }) });
  await confirmPaymentDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Payment processed and receipt generated.")).toBeVisible({ timeout: 30_000 });

  const receiptsAfterCreate = (await getJson(request, session.token, "/receipts/?page=1")) as {
    results: Array<{ id: number; invoice: number; reference_number?: string | null; amount_paid: string }>;
  };
  const createdReceipt = receiptsAfterCreate.results.find((row) => row.invoice === createdInvoice?.id);
  expect(createdReceipt).toBeTruthy();
  expect(createdReceipt?.amount_paid).toBe(amountToPay);

  const receiptRow = page.locator("tbody tr", { hasText: `#${createdInvoice?.id}` }).first();
  await receiptRow.getByRole("button", { name: "Edit" }).click();
  const receiptEditRow = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: "Save" }) }).first();
  await receiptEditRow.locator("input").last().fill(`RCPT-${suffix}`);
  await receiptEditRow.getByRole("button", { name: "Save" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(receiptRow).toContainText(`RCPT-${suffix}`, { timeout: 30_000 });

  const receiptDetailRes = await request.get(`${API_BASE_URL}/receipts/${createdReceipt?.id}/`, {
    headers: authHeaders,
  });
  expect(receiptDetailRes.ok()).toBeTruthy();
  const updatedReceipt = (await receiptDetailRes.json()) as { reference_number?: string | null; invoice: number };
  expect(updatedReceipt.invoice).toBe(createdInvoice?.id);
  expect(updatedReceipt.reference_number).toBe(`RCPT-${suffix}`);
});

test("admin can upload PNG logo, save global settings, and logo shows in user Settings previews", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);
  const officialCompanyName = `AmbienteSoft LTD ${Date.now()}`;

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const fileInput = page.locator("#logo_upload");
  const start = Date.now();
  await fileInput.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png1x1() });
  await expect(page.getByAltText("Global logo preview")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`PNG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  const thumbSrc = await waitForUploadedLogoSrc(page.getByAltText("Global logo preview"));
  expect(thumbSrc).toContain("_thumb");

  const currencySelect = page.getByLabel("Default Currency");
  await expect(currencySelect).toBeVisible({ timeout: 30_000 });
  await currencySelect.selectOption({ index: 1 });
  await page.getByLabel("Company Name").fill(officialCompanyName);
  await page.getByRole("button", { name: "Save Global Settings" }).click();
  await expect(page.getByText("Global settings saved.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByLabel("Invoice preview")).toContainText(officialCompanyName);
  await expect(page.getByLabel("Receipt preview")).toContainText(officialCompanyName);
  const invoiceLogo = page.getByLabel("Invoice preview").locator('img[alt="Invoice logo"]');
  await expect(invoiceLogo).toBeVisible({ timeout: 30_000 });
  await expect(invoiceLogo).toHaveAttribute("src", /127\.0\.0\.1:8000\/media\/uploads\/logos\//);

  const receiptLogo = page.getByLabel("Receipt preview").locator('img[alt="Receipt logo"]');
  await expect(receiptLogo).toBeVisible({ timeout: 30_000 });
  await expect(receiptLogo).toHaveAttribute("src", /127\.0\.0\.1:8000\/media\/uploads\/logos\//);
});

test("admin logo upload validation: rejects unsupported and oversized files; handles network abort", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
  const fileInput = page.locator("#logo_upload");

  await fileInput.setInputFiles({ name: "logo.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
  await expect(page.getByText("Unsupported file type. Only JPG, PNG, SVG, and WebP are allowed.")).toBeVisible();

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
  await fileInput.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: oversized });
  await expect(page.getByText("File too large. Maximum size is 5MB.")).toBeVisible();

  await page.route("**/api/admin/logo/upload/", async (route) => {
    await route.abort();
  });
  await fileInput.setInputFiles({ name: "logo.jpg", mimeType: "image/jpeg", buffer: jpg1x1() });
  await expect(page.getByText(/upload failed/i)).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/api/admin/logo/upload/");
});

test("admin can upload SVG logo and thumbnail is generated", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const fileInput = page.locator("#logo_upload");
  const start = Date.now();
  await fileInput.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(safeSvg(), "utf-8") });
  await expect(page.getByAltText("Global logo preview")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`SVG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  await waitForUploadedLogoSrc(page.getByAltText("Global logo preview"));
});

test("admin can upload JPG logo and thumbnail is generated", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const fileInput = page.locator("#logo_upload");
  const start = Date.now();
  await fileInput.setInputFiles({ name: "logo.jpg", mimeType: "image/jpeg", buffer: jpg1x1() });
  await expect(page.getByAltText("Global logo preview")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`JPG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  const thumbSrc = await waitForUploadedLogoSrc(page.getByAltText("Global logo preview"));
  expect(thumbSrc).toContain("_thumb");
});

test("admin logo upload blocks concurrent uploads while in progress", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  await page.route("**/api/admin/logo/upload/", async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });

  const fileInput = page.locator("#logo_upload");
  await fileInput.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png1x1() });

  await expect(page.getByText(/uploading/i)).toBeVisible({ timeout: 10_000 });
  await expect(fileInput).toBeDisabled();

  await expect(page.getByAltText("Global logo preview")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/api/admin/logo/upload/");
});

test("standard user can upload invoice and receipt logos with preview and persistence", async ({ page, request }) => {
  const session = await registerAndReachDashboard(page);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const invoiceFileInput = page.locator("#inv_logo_upload");
  await invoiceFileInput.setInputFiles({ name: "invoice-logo.png", mimeType: "image/png", buffer: png1x1() });
  await expect(page.getByAltText("Invoice logo preview")).toBeVisible({ timeout: 30_000 });
  await waitForUploadedLogoSrc(page.getByAltText("Invoice logo preview"));
  await expect(page.getByLabel("Invoice preview").locator('img[alt="Invoice logo"]')).toBeVisible({ timeout: 30_000 });

  const receiptFileInput = page.locator("#rcpt_logo_upload");
  await receiptFileInput.setInputFiles({ name: "receipt-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(safeSvg(), "utf-8") });
  await expect(page.getByAltText("Receipt logo preview")).toBeVisible({ timeout: 30_000 });
  await waitForUploadedLogoSrc(page.getByAltText("Receipt logo preview"));
  await expect(page.getByLabel("Receipt preview").locator('img[alt="Receipt logo"]')).toBeVisible({ timeout: 30_000 });

  await page.locator("#inv_layout").selectOption("compact");
  await page.locator("#rcpt_layout").selectOption("compact");
  await expect(page.getByLabel("Invoice preview")).toHaveAttribute("data-layout", "compact");
  await expect(page.getByLabel("Receipt preview")).toHaveAttribute("data-layout", "compact");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings updated.")).toBeVisible();

  const effective = (await getJson(request, session.token, "/settings/effective/")) as {
    effective: {
      templates: {
        invoice_template: { logo_url?: string | null; layout?: string | null };
        receipt_template: { logo_url?: string | null; layout?: string | null };
      };
    };
  };
  const invoiceLogoUrl = String(effective.effective.templates.invoice_template.logo_url ?? "");
  const receiptLogoUrl = String(effective.effective.templates.receipt_template.logo_url ?? "");
  expect(invoiceLogoUrl).toContain("/media/uploads/logos/");
  expect(receiptLogoUrl).toContain("/media/uploads/logos/");
  expect(String(effective.effective.templates.invoice_template.layout ?? "")).toBe("compact");
  expect(String(effective.effective.templates.receipt_template.layout ?? "")).toBe("compact");

  const invoiceLogoResponse = await request.get(`${BACKEND_ORIGIN}${invoiceLogoUrl}`);
  expect(invoiceLogoResponse.ok()).toBeTruthy();
  expect((await invoiceLogoResponse.body()).length).toBeGreaterThan(0);

  const receiptLogoResponse = await request.get(`${BACKEND_ORIGIN}${receiptLogoUrl}`);
  expect(receiptLogoResponse.ok()).toBeTruthy();
  expect((await receiptLogoResponse.body()).length).toBeGreaterThan(0);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByLabel("Invoice preview").locator('img[alt="Invoice logo"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Receipt preview").locator('img[alt="Receipt logo"]')).toBeVisible({ timeout: 30_000 });
});

test("record payment button validates, confirms, and records a payment", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const customerRes = await request.post(`${API_BASE_URL}/customers/`, { headers: { Authorization: `Token ${token}` }, data: { name: "Pay Buyer" } });
  expect(customerRes.ok()).toBeTruthy();
  const customer = await customerRes.json();

  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "Pay Item", unit_price: "10.00", stock_quantity: 10 },
  });
  expect(itemRes.ok()).toBeTruthy();
  const item = await itemRes.json();

  const invRes = await request.post(`${API_BASE_URL}/invoices/`, {
    headers: { Authorization: `Token ${token}` },
    data: { customer: customer.id, status: "Sent", items: [{ item: item.id, quantity: 1 }] },
  });
  expect(invRes.ok()).toBeTruthy();
  const invoice = await invRes.json();

  await page.goto("/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();

  await page.getByRole("button", { name: "Record Payment" }).click();
  await expect(page.getByRole("heading", { name: "Make Payment" })).toBeVisible();

  await page.getByLabel("Invoice").selectOption(String(invoice.id));
  await page.getByLabel("Amount Paid").fill("10");

  const dateInput = page.getByLabel("Transaction Date");
  if (!(await dateInput.inputValue())) await dateInput.fill("2026-05-01");

  await page.getByLabel("Payment Method").selectOption({ label: "Cash" });

  await page.getByRole("button", { name: "Process Payment" }).click();
  await expect(page.getByRole("heading", { name: "Confirm Payment" })).toBeVisible();

  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Payment processed and receipt generated.")).toBeVisible({ timeout: 30_000 });
});

test("send invoice and receipt inputs allow continuous typing", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const customerRes = await request.post(`${API_BASE_URL}/customers/`, { headers: { Authorization: `Token ${token}` }, data: { name: "Send Buyer" } });
  expect(customerRes.ok()).toBeTruthy();
  const customer = await customerRes.json();

  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "Send Item", unit_price: "10.00", stock_quantity: 10 },
  });
  expect(itemRes.ok()).toBeTruthy();
  const item = await itemRes.json();

  const invRes = await request.post(`${API_BASE_URL}/invoices/`, {
    headers: { Authorization: `Token ${token}` },
    data: { customer: customer.id, status: "Sent", items: [{ item: item.id, quantity: 1 }] },
  });
  expect(invRes.ok()).toBeTruthy();
  const invoice = await invRes.json();

  const ref = `E2E-SEND-REF-${Date.now()}`;
  const payRes = await request.post(`${API_BASE_URL}/invoices/${invoice.id}/pay/`, {
    headers: { Authorization: `Token ${token}`, "Idempotency-Key": `e2e-send-${Date.now()}` },
    data: { amount_paid: "10.00", payment_method: "Bank Transfer", reference_number: ref },
  });
  expect(payRes.ok()).toBeTruthy();

  await page.goto("/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(ref) }).first();
  await row.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByRole("heading", { name: "Send Receipt" })).toBeVisible();

  const receiptEmail = page.getByLabel("To Email");
  await receiptEmail.click();
  await receiptEmail.type("receipt@example.com", { delay: 20 });
  await expect(receiptEmail).toHaveValue("receipt@example.com");
  await expect(receiptEmail).toBeFocused();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Send Receipt" })).toBeHidden();

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  const invRow = page.getByRole("row", { name: new RegExp(String(invoice.invoice_number)) });
  await invRow.getByRole("button", { name: "View Invoice" }).click();
  await expect(page.getByRole("heading", { name: "Invoice Summary" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Send Invoice" })).toBeVisible();

  const invEmail = page.getByLabel("To Email");
  await invEmail.click();
  await invEmail.type("invoice@example.com", { delay: 20 });
  await expect(invEmail).toHaveValue("invoice@example.com");
  await expect(invEmail).toBeFocused();
});

test("send invoice and receipt auto-fills customer email and phone when available", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const customerRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "Auto Buyer", email: "auto@example.com", phone: "+2348012345678" },
  });
  expect(customerRes.ok()).toBeTruthy();
  const customer = await customerRes.json();

  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "Auto Item", unit_price: "10.00", stock_quantity: 10 },
  });
  expect(itemRes.ok()).toBeTruthy();
  const item = await itemRes.json();

  const invRes = await request.post(`${API_BASE_URL}/invoices/`, {
    headers: { Authorization: `Token ${token}` },
    data: { customer: customer.id, status: "Sent", items: [{ item: item.id, quantity: 1 }] },
  });
  expect(invRes.ok()).toBeTruthy();
  const invoice = await invRes.json();

  const ref = `E2E-AUTOFILL-REF-${Date.now()}`;
  const payRes = await request.post(`${API_BASE_URL}/invoices/${invoice.id}/pay/`, {
    headers: { Authorization: `Token ${token}`, "Idempotency-Key": `e2e-autofill-${Date.now()}` },
    data: { amount_paid: "10.00", payment_method: "Bank Transfer", reference_number: ref },
  });
  expect(payRes.ok()).toBeTruthy();

  await page.goto("/receipts");
  await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();
  const receiptRow = page.getByRole("row", { name: new RegExp(ref) }).first();
  await receiptRow.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByRole("heading", { name: "Send Receipt" })).toBeVisible();
  await expect(page.getByLabel("To Email")).toHaveValue("auto@example.com");
  await page.getByLabel("Channel").selectOption("whatsapp");
  await expect(page.getByLabel("To Phone")).toHaveValue("+2348012345678");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  const invRow = page.getByRole("row", { name: new RegExp(String(invoice.invoice_number)) });
  await invRow.getByRole("button", { name: "View Invoice" }).click();
  await expect(page.getByRole("heading", { name: "Invoice Summary" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Send Invoice" })).toBeVisible();
  await expect(page.getByLabel("To Email")).toHaveValue("auto@example.com");
  await page.getByLabel("Channel").selectOption("whatsapp");
  await expect(page.getByLabel("To Phone")).toHaveValue("+2348012345678");
});

test("sending an invoice via WhatsApp opens a wa.me share link with prefilled text", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.addInitScript(() => {
    (window as any).__openCalls = [];
    (window as any).open = (url: any) => {
      (window as any).__openCalls.push(String(url));
      return null;
    };
  });

  const customerRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "WA Share Buyer", email: "wa_share@example.com", phone: "+2348012345678" },
  });
  expect(customerRes.ok()).toBeTruthy();
  const customer = await customerRes.json();

  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: "WA Share Item", unit_price: "10.00", stock_quantity: 10 },
  });
  expect(itemRes.ok()).toBeTruthy();
  const item = await itemRes.json();

  const invRes = await request.post(`${API_BASE_URL}/invoices/`, {
    headers: { Authorization: `Token ${token}` },
    data: { customer: customer.id, status: "Sent", items: [{ item: item.id, quantity: 1 }] },
  });
  expect(invRes.ok()).toBeTruthy();
  const invoice = await invRes.json();

  await request.post(`${API_BASE_URL}/invoices/${invoice.id}/pay/`, {
    headers: { Authorization: `Token ${token}`, "Idempotency-Key": `e2e-wa-share-${Date.now()}` },
    data: { amount_paid: "10.00", payment_method: "Cash", reference_number: `E2E-WA-SHARE-${Date.now()}` },
  });

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).first().click();
  const invRow = page.getByRole("row", { name: new RegExp(String(invoice.invoice_number)) }).first();
  await invRow.getByRole("button", { name: "View Invoice" }).first().click({ force: true });
  await expect(page.getByRole("heading", { name: "Invoice Summary" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByRole("heading", { name: "Send Invoice" })).toBeVisible();
  const sendDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Send Invoice" }) });
  await sendDialog.getByLabel("Channel").selectOption("whatsapp");

  await sendDialog.getByRole("button", { name: "Send" }).first().click({ force: true });
  await page.waitForFunction(() => Array.isArray((window as any).__openCalls) && (window as any).__openCalls.length > 0);
  const openCalls = await page.evaluate(() => (window as any).__openCalls as string[]);
  expect(openCalls[0]).toContain("https://wa.me/");
  expect(openCalls[0]).toContain("text=");
});

test("inventory export and import flows work end-to-end", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.addInitScript(() => {
    (window as any).__downloadObjectUrlCalls = 0;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((...args: any[]) => {
      (window as any).__downloadObjectUrlCalls += 1;
      return orig(...(args as [any]));
    }) as any;
  });

  await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { type: "product", name: `E2E Widget ${Date.now()}`, sku: `E2E-SKU-${Date.now()}`, unit_price: "10.00", tax_rate: "0.00", stock_quantity: 5 },
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByLabel("Format").selectOption("csv");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);

  await page.getByRole("button", { name: "Import" }).click();
  const sku = `E2E-IMP-${Date.now()}`;
  const csv = Buffer.from(
    `type,sku,name,unit_price,tax_rate,stock_quantity\nproduct,${sku},Imported Item ${sku},12.50,0,3\n`,
    "utf-8"
  );
  const invDialog = page.getByRole("dialog");
  const paddingLeft = await invDialog.evaluate((el) => Number.parseFloat(window.getComputedStyle(el).paddingLeft || "0"));
  expect(paddingLeft).toBeGreaterThanOrEqual(16);
  await invDialog.getByRole("button", { name: "Download template" }).click({ force: true });
  await page.waitForFunction(() => (window as any).__downloadObjectUrlCalls > 0);
  await invDialog.getByLabel("File (.csv or .xlsx)").setInputFiles({ name: "items.csv", mimeType: "text/csv", buffer: csv });
  await invDialog.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Import complete|Validation complete/i)).toBeVisible({ timeout: 30_000 });
});

test("invoice import flow works end-to-end", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

  await page.addInitScript(() => {
    (window as any).__downloadObjectUrlCalls = 0;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((...args: any[]) => {
      (window as any).__downloadObjectUrlCalls += 1;
      return orig(...(args as [any]));
    }) as any;
  });

  const cRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: { Authorization: `Token ${token}` },
    data: { name: `E2E Buyer ${suffix}`, email: `e2e_buyer_${suffix}@example.com` },
  });
  expect(cRes.ok()).toBeTruthy();
  const cust = await cRes.json();

  const sku = `E2E-INV-SKU-${suffix}`;
  const invoiceNumber = `INV-E2E-${suffix}`.slice(0, 50);
  const itemRes = await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { type: "product", name: `E2E Item ${suffix}`, sku, unit_price: "10.00", tax_rate: "0.00", stock_quantity: 10 },
  });
  expect(itemRes.ok()).toBeTruthy();

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Manage Invoices" })).toBeVisible();

  await page.getByRole("button", { name: "Import" }).click();
  const invCsv = Buffer.from(
    [
      "invoice_key,invoice_number,customer_email,customer_name,status,issue_date,due_date,item_sku,quantity,unit_price,tax_rate,description,unit_of_measure",
      `B1,${invoiceNumber},${cust.email},,Sent,2026-05-01,2026-05-10,${sku},2,,,Line 1,pcs`,
      `B1,${invoiceNumber},${cust.email},,Sent,2026-05-01,2026-05-10,${sku},1,,,Line 2,pcs`,
      "",
    ].join("\n"),
    "utf-8"
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Download template" }).click({ force: true });
  await page.waitForFunction(() => (window as any).__downloadObjectUrlCalls > 0);
  await dialog.getByLabel("File (.csv or .xlsx)").setInputFiles({ name: "invoices.csv", mimeType: "text/csv", buffer: invCsv });
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(dialog.getByText("Imported invoices: 1")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Imported line items: 2")).toBeVisible({ timeout: 30_000 });

  const importedInvoices = (await getJson(request, token, `/invoices/?invoice_number=${encodeURIComponent(invoiceNumber)}`)) as {
    results: Array<{ invoice_number: string }>;
  };
  expect(importedInvoices.results.some((row) => row.invoice_number === invoiceNumber)).toBeTruthy();
});

test("import template endpoints return downloadable files", async ({ request }) => {
  const token = await adminToken(request);

  const itemsTpl = await request.get(`${API_BASE_URL}/items/import_template/?file_format=xlsx`, {
    headers: { Authorization: `Token ${token}` },
  });
  expect(itemsTpl.ok()).toBeTruthy();
  expect(itemsTpl.headers()["content-type"] ?? "").toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(itemsTpl.headers()["content-disposition"] ?? "").toContain("inventory_import_template.xlsx");

  const invTpl = await request.get(`${API_BASE_URL}/invoices/import_template/?file_format=xlsx`, {
    headers: { Authorization: `Token ${token}` },
  });
  expect(invTpl.ok()).toBeTruthy();
  expect(invTpl.headers()["content-type"] ?? "").toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(invTpl.headers()["content-disposition"] ?? "").toContain("invoice_import_template.xlsx");
});

test("dialogs have consistent padding across desktop/tablet/mobile", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const viewports = [
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 375, height: 667 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize(vp);
    await page.goto("/inventory", { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog");
    const padding = await dialog.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        left: Number.parseFloat(cs.paddingLeft || "0"),
        right: Number.parseFloat(cs.paddingRight || "0"),
        top: Number.parseFloat(cs.paddingTop || "0"),
        bottom: Number.parseFloat(cs.paddingBottom || "0"),
      };
    });
    expect(padding.left).toBeGreaterThanOrEqual(16);
    expect(padding.right).toBeGreaterThanOrEqual(16);
    expect(padding.top).toBeGreaterThanOrEqual(16);
    expect(padding.bottom).toBeGreaterThanOrEqual(16);
    await dialog.getByRole("button", { name: "Close" }).click();
  }
});
