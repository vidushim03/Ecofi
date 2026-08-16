const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4000",
    headless: true,
  },
  webServer: {
    command: "node tests/e2e/server-boot.mjs",
    port: 4000,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
