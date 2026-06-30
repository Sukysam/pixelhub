import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1080 },
] as const;

for (const viewport of viewports) {
  test(`landing page shows PXL INVOICE cleanly on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/", { waitUntil: "networkidle" });

    const welcome = page.getByText("Welcome to PXL INVOICE");
    const signupPrompt = page.getByText("New to PXL INVOICE?");

    await expect(welcome).toBeVisible();
    await expect(signupPrompt).toBeVisible();

    const title = await page.title();
    expect(title).toBe("PXL INVOICE - Business Management");

    const meta = await page.evaluate(() => ({
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") || null,
      ogSiteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || null,
      twitterTitle: document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") || null,
      appName: document.querySelector('meta[name="application-name"]')?.getAttribute("content") || null,
      htmlHasOldBrand: document.documentElement.outerHTML.includes("PIXELHUB"),
      bodyHasOldBrand: document.body.innerText.includes("PIXELHUB"),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      oldBrandAttrHits: Array.from(document.querySelectorAll("*")).flatMap((el) =>
        ["aria-label", "alt", "title"].flatMap((attr) => {
          const value = el.getAttribute(attr);
          return value && value.includes("PIXELHUB") ? [`${el.tagName.toLowerCase()}:${attr}=${value}`] : [];
        })
      ),
    }));

    expect(meta.ogTitle).toBe("PXL INVOICE - Business Management");
    expect(meta.ogSiteName).toBe("PXL INVOICE");
    expect(meta.twitterTitle).toBe("PXL INVOICE - Business Management");
    expect(meta.appName).toBe("PXL INVOICE");
    expect(meta.htmlHasOldBrand).toBe(false);
    expect(meta.bodyHasOldBrand).toBe(false);
    expect(meta.oldBrandAttrHits).toEqual([]);
    expect(meta.overflow).toBeLessThanOrEqual(1);

    const welcomeBox = await welcome.boundingBox();
    const signupPromptBox = await signupPrompt.boundingBox();
    expect(welcomeBox).not.toBeNull();
    expect(signupPromptBox).not.toBeNull();
    expect((welcomeBox?.x ?? 0) + (welcomeBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    expect((signupPromptBox?.x ?? 0) + (signupPromptBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("link", { name: "Create account" }).click();
    await page.waitForURL("**/register");
    await expect(page).toHaveURL(/\/register$/);

    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL("**/forgot-password");
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
}

for (const route of ["/terms", "/privacy"]) {
  test(`${route} shows the updated brand text without overflow`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const html = await page.content();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    expect(html.includes("PIXELHUB")).toBe(false);
    expect(html.includes("PXL INVOICE")).toBe(true);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
