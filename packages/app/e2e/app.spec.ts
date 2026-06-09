import { test, expect, _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

test("Electron window launches and loads content", async () => {
  const fixturePath = join(__dirname, "fixtures", "minimal-app", "main.cjs");

  const electronApp = await electron.launch({
    args: [fixturePath],
  });

  const window = await electronApp.firstWindow();
  expect(window).toBeTruthy();

  const title = await window.title();
  expect(title).toBe("E2E Test Window");

  await electronApp.close();
});
