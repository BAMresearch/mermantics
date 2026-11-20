/** Optional browser check of "Export → Picture" (src/canvas/canvasImage.ts). Run against
 * `npm run dev` with Playwright available; see web/README.md. It checks what only a real browser
 * shows: that the arrows are in the picture (each is its own <svg>, which clips unless told
 * otherwise), that the selection is left out and comes back, and that the SVG stays small.
 * PICTURE_OUT=<dir> also keeps the pictures, to look at them.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const out = process.env.PICTURE_OUT;
if (out) mkdirSync(out, { recursive: true });

async function exportPicture(page, format) {
  await page.locator('summary[aria-label="Export"]').click();
  const [download] = await Promise.all([page.waitForEvent("download"),
    page.getByRole("button", { name: `Picture .${format}` }).click()]);
  const bytes = readFileSync(await download.path());
  if (out) writeFileSync(join(out, download.suggestedFilename()), bytes);
  return bytes;
}

async function openExample(page, section) {
  await page.goto(process.env.PICTURE_TEST_URL || "http://127.0.0.1:5173/");
  await page.locator(`.start-${section}`).click();
  await page.locator('summary[aria-label="Examples"]').click();
  await page.locator(".toolbar-dropdown button").first().click();
  await page.locator(".react-flow__edge").first().waitFor();
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await openExample(page, "process");
  const arrows = await page.locator(".react-flow__edge").count();
  await page.locator(".react-flow__node").nth(1).click();
  await page.locator(".react-flow__node.selected").waitFor();

  const svg = (await exportPicture(page, "svg")).toString("utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<image /, "the SVG is drawn, not a PNG wrapped in SVG");
  assert.equal(svg.match(/class="react-flow__edge-path"/g)?.length, arrows, "every arrow is in the SVG");
  const inner = svg.match(/<svg[^>]*>/g).slice(1);
  assert.ok(inner.length > 0 && inner.every((tag) => /overflow: visible/.test(tag)), "arrows are not clipped");
  assert.doesNotMatch(svg, /react-flow__handle/, "no connection dots");
  assert.doesNotMatch(svg, /react-flow__node[^"]*\bselected\b/, "no selection");
  assert.doesNotMatch(svg, /--xy-/, "no CSS variables");
  assert.ok(svg.length < 600_000, `the SVG is small (${svg.length} bytes)`);
  const width = Number(svg.match(/width="(\d+)"/)[1]);

  const png = await exportPicture(page, "png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 2 * width, "the PNG has twice the pixels of the SVG");

  // The download starts just before the canvas is drawn with the selection again.
  await page.locator(".react-flow__node.selected").waitFor({ timeout: 2000 });

  // The openBIS view: the lanes are part of the picture too.
  await openExample(page, "datastore");
  await page.locator('summary[aria-label="View"]').click();
  await page.getByRole("button", { name: "openBIS view" }).click();
  await page.locator(".react-flow__node-lane").first().waitFor();
  const lanes = (await exportPicture(page, "svg")).toString("utf8");
  assert.ok((lanes.match(/react-flow__node-lane/g)?.length ?? 0) > 0, "the openBIS lanes are in the picture");

  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".notice").count(), 0, "no error notice");
  console.log(`Picture export check passed${out ? `; pictures in ${out}` : ""}.`);
} finally {
  await browser.close();
}
