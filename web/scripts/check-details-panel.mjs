/** Optional browser regression check. Run against `npm run dev` with Playwright available.
 * PLAYWRIGHT_MODULE may point to an existing Playwright installation; no project dependency is required.
 */
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(process.env.PANEL_TEST_URL || "http://127.0.0.1:5173/");
  await page.locator(".start-process").click();
  const divider = page.getByRole("separator", { name: "Resize details panel" });
  const panel = page.locator("#details-panel");
  const checkWidth = async (expected) => {
    await page.waitForFunction((width) => {
      const separator = document.querySelector('.details-resizer');
      const panel = document.querySelector('#details-panel');
      return separator?.getAttribute('aria-valuenow') === String(width)
        && Math.abs(panel.getBoundingClientRect().width - width) < 1;
    }, expected);
  };
  await divider.press("End");
  await checkWidth(600);
  await page.setViewportSize({ width: 1000, height: 900 });
  await checkWidth(444);
  await page.setViewportSize({ width: 1200, height: 900 });
  await checkWidth(600);
  await page.setViewportSize({ width: 1000, height: 900 });
  await checkWidth(444);
  await divider.press("ArrowRight");
  await checkWidth(424);
  await divider.press("Home");
  await divider.press("ArrowRight");
  await checkWidth(240);
  await divider.press("End");
  await checkWidth(444);
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 100, { steps: 8 });
  await page.mouse.up();
  await checkWidth(364);
  const canvasBefore = (await page.locator("main.canvas").boundingBox()).width;
  await page.getByRole("button", { name: "Collapse details panel" }).click();
  assert.equal(await panel.isVisible(), false);
  assert.ok((await page.locator("main.canvas").boundingBox()).width > canvasBefore + 350);
  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(await divider.count(), 0);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.body').classList.contains('open-details'));
  assert.equal(await panel.evaluate((element) => element.hidden), false);
  assert.ok(Math.abs((await panel.boundingBox()).width - 900) < 1);
  await page.setViewportSize({ width: 901, height: 900 });
  await page.getByRole("button", { name: "‹ Details", exact: true }).click();
  await checkWidth(345);
  await page.setViewportSize({ width: 1200, height: 900 });
  await checkWidth(364);
  console.log("Details panel browser checks passed (desktop layout, drag, keyboard, collapse, and mobile transitions).");
} finally {
  await browser.close();
}
