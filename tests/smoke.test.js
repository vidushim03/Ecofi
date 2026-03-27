const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const scriptJs = fs.readFileSync(path.join(rootDir, "script.js"), "utf8");
const serverJs = fs.readFileSync(
  path.join(rootDir, "backend", "server.js"),
  "utf8"
);

test("frontend assets do not use machine-specific absolute paths", () => {
  assert.ok(
    !indexHtml.includes("C:\\Users\\"),
    "index.html should not contain local absolute Windows paths"
  );
  assert.match(indexHtml, /images\/logo-main\.png/);
});

test("frontend API requests use apiUrl helper", () => {
  assert.ok(
    !scriptJs.includes("fetch(\"http://localhost:4000"),
    "Hardcoded localhost fetch calls should not exist"
  );
  assert.match(scriptJs, /function apiUrl\(path\)/);
  assert.match(scriptJs, /new URL\(apiUrl\("\/api\/products"\)\)/);
});

test("backend exposes required core routes", () => {
  const requiredRoutes = [
    "app.post(\"/api/signup\"",
    "app.post(\"/api/login\"",
    "app.get(\"/api/products\"",
    "app.get(\"/api/wishlist\"",
    "app.post(\"/api/wishlist/toggle\"",
  ];

  for (const route of requiredRoutes) {
    assert.ok(serverJs.includes(route), `Missing required route: ${route}`);
  }
});
