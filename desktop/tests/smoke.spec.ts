import { test, expect, _electron as electron } from "@playwright/test";

const shouldRun = process.env.RUN_ELECTRON_E2E === "1";

test.skip(!shouldRun, "Set RUN_ELECTRON_E2E=1 to enable Electron launch tests.");

test("desktop app launches", async () => {
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, APP_URL: "about:blank", NODE_ENV: "production", AUTO_UPDATE: "0" }
  });

  const window = await app.firstWindow();
  await expect(window).toBeTruthy();
  await expect(window).toHaveURL("about:blank");

  await app.close();
});
