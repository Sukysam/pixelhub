import { test, expect } from "@playwright/test";
import crypto from "crypto";
import { API_BASE_URL, adminToken, setSession } from "./helpers/admin";

test("invoice customer search finds partial, mixed-case, special-character, and non-Latin names", async ({ page, request }) => {
  const token = await adminToken(request);
  await setSession(page, request, token);

  const suffix = `${Date.now()}_${crypto.randomBytes(2).toString("hex")}`;
  const authHeaders = { Authorization: `Token ${token}` };

  const specialRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: authHeaders,
    data: { name: `Anne-Marie O'Connor ${suffix}`, email: `anne_${suffix}@example.com` },
  });
  expect(specialRes.ok()).toBeTruthy();
  const specialCustomer = (await specialRes.json()) as { id: number; name: string };

  const accentRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: authHeaders,
    data: { name: `João Silva ${suffix}`, email: `joao_${suffix}@example.com` },
  });
  expect(accentRes.ok()).toBeTruthy();
  const accentCustomer = (await accentRes.json()) as { id: number; name: string };

  const mixedRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: authHeaders,
    data: { name: `MIXED Case Holdings ${suffix}`, email: `mixed_${suffix}@example.com` },
  });
  expect(mixedRes.ok()).toBeTruthy();
  const mixedCustomer = (await mixedRes.json()) as { id: number; name: string };

  const nonLatinRes = await request.post(`${API_BASE_URL}/customers/`, {
    headers: authHeaders,
    data: { name: `客户名字阿明 ${suffix}`, email: `aming_${suffix}@example.com` },
  });
  expect(nonLatinRes.ok()).toBeTruthy();
  const nonLatinCustomer = (await nonLatinRes.json()) as { id: number; name: string };

  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Create Invoice" })).toBeVisible({ timeout: 30_000 });

  const searchInput = page.getByRole("searchbox", { name: "Search customers for invoice" });
  const customerSelect = page.locator("#customer_select");

  await searchInput.fill(`oconnor anne ${suffix}`);
  await expect(customerSelect.locator(`option[value="${specialCustomer.id}"]`)).toHaveCount(1);
  await customerSelect.selectOption(String(specialCustomer.id));
  await expect(customerSelect).toHaveValue(String(specialCustomer.id));
  await expect(searchInput).toHaveValue("");

  await searchInput.fill(`joao ${suffix}`);
  await expect(customerSelect.locator(`option[value="${accentCustomer.id}"]`)).toHaveCount(1);

  await searchInput.fill(`holdings mixed ${suffix}`);
  await expect(customerSelect.locator(`option[value="${mixedCustomer.id}"]`)).toHaveCount(1);

  await searchInput.fill("阿明");
  await expect(customerSelect.locator(`option[value="${nonLatinCustomer.id}"]`)).toHaveCount(1);

  await searchInput.fill(`definitely-no-match-${suffix}`);
  await expect(page.getByText("No matching customers found.")).toBeVisible();
});
