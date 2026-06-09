// Minimal Electron CJS fixture for Playwright E2E testing.
// electron-vite bundled ESM output is incompatible with Playwright's CJS electron loader,
// so we use this fixture to verify the Playwright+Electron integration works.
const { app, BrowserWindow } = require("electron");

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: "E2E Test Window",
  });
  win.loadURL(
    "data:text/html,<html><head><title>E2E Test Window</title></head><body><h1>E2E Test</h1></body></html>",
  );
});
