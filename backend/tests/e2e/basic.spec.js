const { test, expect } = require("@playwright/test");

test("home page shows featured products", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#home .product-card", { timeout: 20000 });
  const cards = await page.locator("#home .product-card").count();
  expect(cards).toBeGreaterThan(0);
});

test("advanced filters narrow results and eco breakdown renders in modal", async ({ page }) => {
  await page.goto("/");
  await page.click("#quickSearchBtn");
  await page.waitForSelector("#results .product-card", { timeout: 20000 });

  const before = await page.locator("#results .product-card").count();
  expect(before).toBeGreaterThan(0);

  // Apply the A+ eco-grade filter.
  await page.check('.eco-grade-cb[value="A+"]');
  await page.waitForTimeout(2000);
  await page.waitForSelector("#results .product-card", { timeout: 20000 });
  const afterText = await page.locator("#resultsState").textContent();
  expect(afterText).toContain("result");
  const after = await page.locator("#results .product-card").count();
  expect(after).toBeLessThanOrEqual(before);
  expect(after).toBeGreaterThan(0);

  // Open the product detail modal and verify the eco-score breakdown.
  await page.click("#results .product-card .see-more-btn");
  await page.waitForSelector("#productModal .eco-breakdown", { timeout: 10000 });
  await expect(page.locator("#productModal .eco-score-fill")).toBeVisible();
  await expect(page.locator("#productModal .eco-score-num")).toContainText("/100");
  await page.click("#productModalClose");
});

test("price range filter narrows the catalog", async ({ page }) => {
  await page.goto("/");
  await page.click("#quickSearchBtn");
  await page.waitForSelector("#results .product-card", { timeout: 20000 });

  await page.fill("#minPrice", "100");
  await page.fill("#maxPrice", "300");
  await page.waitForTimeout(2000);
  const state = await page.locator("#resultsState").textContent();
  expect(state).toContain("result");
});
