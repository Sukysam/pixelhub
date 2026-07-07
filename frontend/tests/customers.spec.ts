import { test, expect, type Page, type Response } from "@playwright/test";
import crypto from "crypto";
import { API_BASE_URL, adminToken, createStandardBusinessUserSession, setSession } from "./helpers/admin";

function buildPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 50) return normalized;
  return `${normalized.slice(0, 47).trimEnd()}...`;
}

async function loadMoreUntilRowVisible(page: Page, customerName: string, maxPages = 6) {
  const row = page.locator("tbody tr", { hasText: customerName }).first();
  for (let attempt = 0; attempt < maxPages; attempt += 1) {
    if ((await row.count()) > 0) return row;
    const loadMoreButton = page.getByRole("button", { name: "Load More" });
    if ((await loadMoreButton.count()) === 0) break;
    const customersResponse = page.waitForResponse(
      (response: Response) =>
        response.url().includes("/api/customers/?page=") &&
        response.request().method() === "GET" &&
        response.status() === 200
    );
    await loadMoreButton.click();
    await customersResponse;
  }
  return row;
}

test("admin can preview internal customer notes from the customers list after pagination", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const suffix = `${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
  const customerName = `Paged Notes Customer ${suffix}`;
  const note =
    "Internal note for customer operations follow-up that intentionally exceeds fifty characters for preview coverage.";
  const expectedPreview = buildPreview(note);
  const authHeaders = { Authorization: `Token ${token}` };

  const createCustomerRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: authHeaders,
    data: {
      name: customerName,
      email: `paged_notes_${suffix}@example.com`,
      internal_remarks: note,
    },
  });
  expect(createCustomerRes.ok()).toBeTruthy();
  const createdCustomer = (await createCustomerRes.json()) as { id: number };

  for (let i = 0; i < 26; i += 1) {
    const fillerRes = await request.post(`${API_BASE_URL}/customers/`, {
      headers: authHeaders,
      data: {
        name: `Paged Filler ${suffix}-${i}`,
        email: `paged_filler_${suffix}_${i}@example.com`,
      },
    });
    expect(fillerRes.ok()).toBeTruthy();
  }

  const filteredListRes = await request.get(
    `${API_BASE_URL}/customers/?q=${encodeURIComponent(customerName)}&ordering=name&page=1`,
    { headers: authHeaders }
  );
  expect(filteredListRes.ok()).toBeTruthy();
  const filteredList = (await filteredListRes.json()) as {
    results: Array<{ id: number; internal_remarks_preview?: string; internal_remarks?: string }>;
  };
  const filteredCustomer = filteredList.results.find((row) => row.id === createdCustomer.id);
  expect(filteredCustomer?.internal_remarks_preview).toBe(expectedPreview);
  expect(filteredCustomer && !("internal_remarks" in filteredCustomer)).toBeTruthy();

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("columnheader", { name: "Internal Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load More" })).toBeVisible({ timeout: 30_000 });
  const customerRow = await loadMoreUntilRowVisible(page, customerName);
  await expect(customerRow).toBeVisible({ timeout: 30_000 });
  const previewButton = customerRow.getByRole("button", { name: `View internal notes for ${customerName}` });
  await expect(previewButton).toContainText(expectedPreview);

  const detailResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_BASE_URL}/customers/${createdCustomer.id}/` &&
      response.request().method() === "GET" &&
      response.status() === 200
  );
  await previewButton.focus();
  await page.keyboard.press("Enter");
  await detailResponse;

  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Internal Customer Notes: ${customerName}` }) });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByLabel("Notes")).toHaveValue(note);
});

test("standard business user cannot see the internal notes preview column", async ({ page }) => {
  const session = await createStandardBusinessUserSession(page.request);
  await setSession(page, page.request, session.token);

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("columnheader", { name: "Internal Notes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View internal notes/i })).toHaveCount(0);
});
