import { test, expect, type Page } from "@playwright/test";
import crypto from "crypto";
import { API_BASE_URL, adminToken, createStandardBusinessUserSession, setSession } from "./helpers/admin";

function buildPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 50) return normalized;
  return `${normalized.slice(0, 47).trimEnd()}...`;
}

async function loadMoreUntilRowVisible(page: Page, customerName: string, maxPages = 6) {
  const row = page.locator("tbody tr", { hasText: customerName }).first();

  const clickLoadMoreAndWaitForResponse = async (loadMoreButton: ReturnType<Page["getByRole"]>) => {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().startsWith(`${API_BASE_URL}/customers/`) &&
          response.request().method() === "GET" &&
          response.status() === 200,
        { timeout: 10_000 }
      )
      .then((response) => ({ url: response.url(), status: response.status() }))
      .catch(() => null);
    // `disabled={loading}` on the button means a click while a request is still
    // in flight simply waits for the button to re-enable, so retrying here can't
    // race a duplicate fetch of the same page.
    //
    // Uses dispatchEvent instead of click(): traces showed Playwright's native
    // click on Firefox sometimes completes successfully (per its own actionability
    // checks) without the event ever reaching React's handler, and no fetch
    // follows. dispatchEvent fires the DOM click directly, bypassing whatever
    // drops the native input on that path.
    await loadMoreButton.dispatchEvent("click");
    return responsePromise;
  };

  for (let attempt = 0; attempt < maxPages; attempt += 1) {
    if ((await row.count()) > 0) return row;
    const loadMoreButton = page.getByRole("button", { name: /load more/i });
    if ((await loadMoreButton.count()) === 0 || !(await loadMoreButton.isVisible())) break;
    const previousRowCount = await page.locator("tbody tr").count();
    console.log(`[loadMore attempt ${attempt}] rows=${previousRowCount} clicking...`);
    let responseInfo = await clickLoadMoreAndWaitForResponse(loadMoreButton);
    if (!responseInfo) {
      // Observed in CI: the click completes and no network request follows at
      // all (not a slow response) — an intermittent Firefox click-dispatch
      // miss. Re-clicking recovers it; a longer timeout would not.
      console.log(`[loadMore attempt ${attempt}] no response within 10s, retrying click once...`);
      responseInfo = await clickLoadMoreAndWaitForResponse(loadMoreButton);
    }
    console.log(
      `[loadMore attempt ${attempt}] response=${responseInfo ? `${responseInfo.status} ${responseInfo.url}` : "TIMED OUT twice (no matching GET /customers/ after retry)"}`
    );
    let finalStatus = "unknown";
    await expect
      .poll(
        async () => {
          if ((await row.count()) > 0) return "row-visible";
          if ((await page.locator("tbody tr").count()) !== previousRowCount) return "row-count-changed";
          if ((await loadMoreButton.count()) === 0 || !(await loadMoreButton.isVisible())) return "pagination-finished";
          return "waiting";
        },
        { timeout: 10_000 }
      )
      .not.toBe("waiting")
      .catch(async (e) => {
        finalStatus = `stuck rows=${await page.locator("tbody tr").count()} buttonVisible=${await loadMoreButton.isVisible().catch(() => "n/a")}`;
        throw e;
      });
    console.log(`[loadMore attempt ${attempt}] resolved rows=${await page.locator("tbody tr").count()} ${finalStatus}`);
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
  await expect(page.getByRole("button", { name: /load more/i })).toBeVisible({ timeout: 30_000 });
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
  await Promise.all([detailResponse, previewButton.click()]);

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
