import { test, expect } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000/api";
let cachedAdminTokenValue: string | null = null;
const ADMIN_TOKEN_CACHE_PATH = path.join(os.tmpdir(), "pixelhub-e2e-admin-token.json");
const ADMIN_TOKEN_LOCK_PATH = `${ADMIN_TOKEN_CACHE_PATH}.lock`;

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function validateToken(request: any, token: string): Promise<boolean> {
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

async function adminToken(request: any) {
  if (cachedAdminTokenValue) return cachedAdminTokenValue;
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
  }

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

async function setSession(page: any, request: any, token: string) {
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

function png1x1(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n6nQAAAAASUVORK5CYII=",
    "base64"
  );
}

function jpg1x1(): Buffer {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCeAAX/2Q==",
    "base64"
  );
}

function safeSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0ea5e9"/><text x="8" y="36" font-size="18" fill="#fff">LOGO</text></svg>`;
}

function uniqueNgPhone(): string {
  const digits = crypto.randomBytes(6).toString("hex").replace(/\D/g, "").padEnd(9, "0").slice(0, 9);
  return `8${digits}`;
}

async function registerAndReachDashboard(page: any) {
  const email = `e2e_settings_${Date.now()}@example.com`;
  const signupSecret = `pw_${crypto.randomBytes(8).toString("hex")}A!`;
  const phone = uniqueNgPhone();
  const token = await adminToken(page.request);
  const createRes = await page.request.post(`${API_BASE_URL}/admin/users/`, {
    headers: { Authorization: `Token ${token}` },
    data: {
      username: email,
      email,
      password: signupSecret,
      company_name: "E2E Settings Co",
      phone,
      is_active: true,
      primary_role: "user",
      custom_roles: [],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const loginRes = await page.request.post(`${API_BASE_URL}/auth/token/`, {
    data: { username: email, password: signupSecret, remember: true },
  });
  expect(loginRes.ok()).toBeTruthy();
  const login = (await loginRes.json()) as { token: string };
  await setSession(page, page.request, login.token);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
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
  await userDialog.locator("label").filter({ hasText: roleName }).locator('input[type="checkbox"]').check();
  await userDialog.getByRole("button", { name: "Create user" }).evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.getByText("User created successfully.")).toBeVisible({ timeout: 30_000 });

  const createdLoginRes = await request.post(`${API_BASE_URL}/auth/token/`, {
    data: { username: email, password: userPassword, remember: true },
  });
  expect(createdLoginRes.ok()).toBeTruthy();
  const createdLogin = (await createdLoginRes.json()) as { token: string };
  const createdMeRes = await request.get(`${API_BASE_URL}/auth/me/`, {
    headers: { Authorization: `Token ${createdLogin.token}` },
  });
  expect(createdMeRes.ok()).toBeTruthy();
  const createdMe = (await createdMeRes.json()) as { roles?: string[]; email?: string };
  expect(createdMe.email).toBe(email);
  expect(createdMe.roles ?? []).toContain(roleName);
});

test("user can update invoice footer in settings", async ({ page }) => {
  await registerAndReachDashboard(page);

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

  await expect(footer).toHaveValue(newValue);
  await expect(page.getByText(newValue)).toBeVisible();
});

test("user can select NGN currency in settings", async ({ page }) => {
  await registerAndReachDashboard(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const currency = page.getByLabel("Currency");
  await expect(currency).toBeVisible({ timeout: 30_000 });
  await currency.selectOption({ label: "NGN (₦)" });

  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(currency).toHaveValue(/^\d+$/);
  await expect(page.getByLabel("Invoice preview")).toContainText(/NGN|₦/);
});

test("admin can upload PNG logo, save global settings, and logo shows in user Settings previews", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const fileInput = page.locator("#logo_upload");
  const start = Date.now();
  await fileInput.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png1x1() });
  await expect(page.getByAltText("Logo thumbnail")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`PNG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  const thumbSrc = await page.getByAltText("Logo thumbnail").getAttribute("src");
  expect(thumbSrc ?? "").toContain("http://127.0.0.1:8000/");
  expect(thumbSrc ?? "").toContain("/media/uploads/logos/");
  expect(thumbSrc ?? "").toContain("_thumb");

  const currencySelect = page.getByLabel("Default Currency");
  await expect(currencySelect).toBeVisible({ timeout: 30_000 });
  await currencySelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save Global Settings" }).click();
  await expect(page.getByText("Global settings saved.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const invoiceLogo = page.getByLabel("Invoice preview").locator('img[alt="Logo"]');
  await expect(invoiceLogo).toBeVisible({ timeout: 30_000 });
  await expect(invoiceLogo).toHaveAttribute("src", /127\.0\.0\.1:8000\/media\/uploads\/logos\//);

  const receiptLogo = page.getByLabel("Receipt preview").locator('img[alt="Logo"]');
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
  await expect(page.getByText("Unsupported file type. Only JPG, PNG, SVG are allowed.")).toBeVisible();

  const oversized = Buffer.alloc(2_000_001, 0);
  await fileInput.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: oversized });
  await expect(page.getByText("File too large. Maximum size is 2MB.")).toBeVisible();

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
  await expect(page.getByAltText("Logo thumbnail")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`SVG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  const thumbSrc = await page.getByAltText("Logo thumbnail").getAttribute("src");
  expect(thumbSrc ?? "").toContain("/media/uploads/logos/");
});

test("admin can upload JPG logo and thumbnail is generated", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  const fileInput = page.locator("#logo_upload");
  const start = Date.now();
  await fileInput.setInputFiles({ name: "logo.jpg", mimeType: "image/jpeg", buffer: jpg1x1() });
  await expect(page.getByAltText("Logo thumbnail")).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - start;
  console.log(`JPG logo upload -> thumbnail visible in ${elapsedMs}ms`);

  const thumbSrc = await page.getByAltText("Logo thumbnail").getAttribute("src");
  expect(thumbSrc ?? "").toContain("/media/uploads/logos/");
  expect(thumbSrc ?? "").toContain("_thumb");
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

  await expect(page.getByAltText("Logo thumbnail")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/api/admin/logo/upload/");
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
    data: { name: `E2E Buyer ${Date.now()}`, email: `e2e_buyer_${Date.now()}@example.com` },
  });
  expect(cRes.ok()).toBeTruthy();
  const cust = await cRes.json();

  const sku = `E2E-INV-SKU-${Date.now()}`;
  await request.post(`${API_BASE_URL}/items/`, {
    headers: { Authorization: `Token ${token}` },
    data: { type: "product", name: `E2E Item ${Date.now()}`, sku, unit_price: "10.00", tax_rate: "0.00", stock_quantity: 10 },
  });

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Manage Invoices" })).toBeVisible();

  await page.getByRole("button", { name: "Import" }).click();
  const invCsv = Buffer.from(
    [
      "invoice_key,invoice_number,customer_email,customer_name,status,issue_date,due_date,item_sku,quantity,unit_price,tax_rate,description,unit_of_measure",
      `B1,,${cust.email},,Sent,2026-05-01,2026-05-10,${sku},2,,,Line 1,pcs`,
      `B1,,${cust.email},,Sent,2026-05-01,2026-05-10,${sku},1,,,Line 2,pcs`,
      "",
    ].join("\n"),
    "utf-8"
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Download template" }).click({ force: true });
  await page.waitForFunction(() => (window as any).__downloadObjectUrlCalls > 0);
  await dialog.getByLabel("File (.csv or .xlsx)").setInputFiles({ name: "invoices.csv", mimeType: "text/csv", buffer: invCsv });
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText(/Import complete|Validation complete/i)).toBeVisible({ timeout: 30_000 });
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
