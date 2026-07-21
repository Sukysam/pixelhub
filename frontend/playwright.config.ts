import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 2,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
    trace: "retain-on-failure",
  },
  timeout: 60_000,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: "1",
            MOZ_DISABLE_GMP_SANDBOX: "1",
          },
          firefoxUserPrefs: {
            "security.sandbox.content.level": 0,
          },
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
