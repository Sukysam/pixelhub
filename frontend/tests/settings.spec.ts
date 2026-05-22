import { test, expect } from "@playwright/test";
import crypto from "crypto";

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000/api";
let cachedAdminTokenValue: string | null = null;

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totpNow(secretB32: string, digits = 6, periodSeconds = 30): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 1000 / periodSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

async function adminToken(request: any) {
  if (cachedAdminTokenValue) return cachedAdminTokenValue;
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error("E2E_USERNAME and E2E_PASSWORD are required");
  }

  const setupRes = await request.post(`${API_BASE_URL}/auth/admin/mfa/setup/`, { data: { username, password, force_reset: true } });
  expect(setupRes.ok()).toBeTruthy();
  const setup = (await setupRes.json()) as { secret: string };
  const code = totpNow(setup.secret);

  const confirmRes = await request.post(`${API_BASE_URL}/auth/admin/mfa/confirm/`, { data: { username, password, code } });
  expect(confirmRes.ok()).toBeTruthy();
  const confirmed = (await confirmRes.json()) as { token: string };
  cachedAdminTokenValue = confirmed.token;
  return cachedAdminTokenValue;
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

async function registerAndReachDashboard(page: any) {
  const email = `e2e_settings_${Date.now()}@example.com`;
  const signupSecret = `pw_${crypto.randomBytes(8).toString("hex")}A!`;
  await page.goto("/?mode=register");
  await page.getByRole("tab", { name: "Create account" }).click();

  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Company legal name").fill("E2E Settings Co");
  await page.getByLabel(/Registration number/i).fill("RC-123456");
  await page.getByLabel("Business type / industry").selectOption("Technology");
  await page.getByLabel("Business address").fill("1 Test Street, Lagos, NG");
  await page.getByLabel("Certifications (optional)").fill("CAC");
  await page.getByLabel("Password", { exact: true }).fill(signupSecret);
  await page.getByLabel("Confirm password").fill(signupSecret);

  const questionLocator = page.locator('label[for="captcha_answer"] + div');
  await expect(questionLocator).toContainText(/\d/);
  const captchaQuestion = await questionLocator.textContent();
  const nums = (captchaQuestion ?? "").match(/-?\d+/g)?.map((n: string) => Number(n)) ?? [];
  const answer = (nums[0] + nums[1]).toString();
  await page.getByLabel("Captcha").fill(answer);

  await page.getByRole("checkbox", { name: "I agree to the terms." }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 30_000 });
}

test("user can update invoice footer in settings", async ({ page }) => {
  await registerAndReachDashboard(page);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

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

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();
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

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();

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

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();

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

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Admin Settings" })).toBeVisible();

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
