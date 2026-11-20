/** Optional browser check of "Export → Picture" (src/canvas/canvasImage.ts). Run against
 * `npm run dev` with Playwright available; see web/README.md. It checks what only a real browser
 * shows, mostly by drawing the exported pictures and looking at their pixels: nothing is cut off
 * at the edges (curved and parallel arrows, long labels, boxes far apart), the crop does not
 * depend on the pan and zoom, large diagrams stay within what every browser can draw, the
 * selection is left out and comes back, and the SVG stays small.
 * PICTURE_OUT=<dir> also keeps the pictures, to look at them.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARGIN = 32; // as in canvasImage.ts
const ARROWHEAD = 8; // arrowheads may reach this far past the measured bounds into the margin

// Two boxes with three parallel arrows whose long labels push the outer ones far to the sides,
// and a box far away: the crop must hold all of it, and the PNG gets large.
const STRESS = `flowchart TB
    Top["<b>Top</b>"]:::local
    Bottom["<b>Bottom</b>"]:::local
    Far["<b>Far away</b>"]:::local
    Top -. "a very long relationship label number one" .-> Bottom
    Top -. "a very long relationship label number two" .-> Bottom
    Top -. "a very long relationship label number three" .-> Bottom
    Bottom -. "reaches the box far away" .-> Far
    classDef local fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#0f172a
%% mermantics-layout {"Top":[0,0],"Bottom":[0,500],"Far":[2600,1400]}
%% mermantics-kinds {"Top":"process","Bottom":"thing","Far":"thing"}
`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const out = process.env.PICTURE_OUT;
if (out) mkdirSync(out, { recursive: true });

async function exportPicture(page, format, label = "") {
  await page.locator('summary[aria-label="Export"]').click();
  const [download] = await Promise.all([page.waitForEvent("download"),
    page.getByRole("button", { name: `Picture .${format}` }).click()]);
  const bytes = readFileSync(await download.path());
  if (out) writeFileSync(join(out, label + download.suggestedFilename()), bytes);
  return bytes;
}

/** The picture drawn in the browser: its size and the box around everything that is not white. */
function pixels(page, bytes, type) {
  return page.evaluate(async ({ base64, type }) => {
    const image = new Image();
    // A data URL: an SVG with HTML inside, read from a blob URL, would lock the canvas.
    image.src = `data:${type};base64,${base64}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.naturalWidth, height: image.naturalHeight });
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const transparent = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
      .filter((value, i) => i % 4 === 3 && value < 255).length;
    const { data: rgba, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 240) { // also the faint label borders
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    return { width, height, transparent, left, top, right: width - 1 - right, bottom: height - 1 - bottom };
  }, { base64: Buffer.from(bytes).toString("base64"), type });
}

/** Nothing is cut off, and the crop is tight: the content ends in the margin on every side. */
function assertCrop(p, scale, what) {
  assert.equal(p.transparent, 0, `${what}: white all over, no transparent strips`);
  for (const side of ["left", "top", "right", "bottom"]) {
    const gap = p[side] / scale;
    assert.ok(gap >= MARGIN - ARROWHEAD && gap <= MARGIN + 2, `${what}: ${gap.toFixed(1)} px of white on the ${side}, not about ${MARGIN}`);
  }
}

async function open(page, section, text) {
  await page.goto(process.env.PICTURE_TEST_URL || "http://127.0.0.1:5173/");
  await page.locator(`.start-${section}`).click();
  if (text) {
    const file = join(tmpdir(), "picture-export-stress.mmd");
    writeFileSync(file, text);
    await page.locator('input[type="file"]').setInputFiles(file);
  } else {
    await page.locator('summary[aria-label="Examples"]').click();
    await page.locator(".toolbar-dropdown button").first().click();
  }
  await page.locator(".react-flow__edge").first().waitFor();
  await page.waitForTimeout(500); // the first fit of the view
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // The coffee example, with a box selected.
  await open(page, "process");
  const arrows = await page.locator(".react-flow__edge").count();
  await page.locator(".react-flow__node").nth(1).click();
  await page.locator(".react-flow__node.selected").waitFor();

  const svg = (await exportPicture(page, "svg")).toString("utf8");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /<image /, "the SVG is drawn, not a PNG wrapped in SVG");
  assert.equal(svg.match(/class="react-flow__edge-path"/g)?.length, arrows, "every arrow is in the SVG");
  assert.doesNotMatch(svg, /react-flow__handle/, "no connection dots");
  assert.doesNotMatch(svg, /react-flow__node[^"]*\bselected\b/, "no selection");
  assert.doesNotMatch(svg, /--xy-/, "no CSS variables");
  assert.ok(svg.length < 600_000, `the SVG is small (${svg.length} bytes)`);
  assertCrop(await pixels(page, Buffer.from(svg), "image/svg+xml"), 1, "coffee SVG");

  const png = await exportPicture(page, "png");
  const drawn = await pixels(page, png, "image/png");
  assert.equal(drawn.width, 2 * Number(svg.match(/width="(\d+)"/)[1]), "the PNG has twice the pixels of the SVG");
  assertCrop(drawn, 2, "coffee PNG");
  // The download starts just before the canvas is drawn with the selection again.
  await page.locator(".react-flow__node.selected").waitFor({ timeout: 2000 });

  // Parallel arrows with long labels and boxes far apart: nothing cut off, and the PNG gets fewer
  // pixels than twice, so that every browser (iOS Safari: 4096 × 4096 in all) can draw it.
  await open(page, "process", STRESS);
  const stressSvg = await exportPicture(page, "svg", "stress-");
  const flat = await pixels(page, stressSvg, "image/svg+xml");
  assertCrop(flat, 1, "stress SVG");
  const big = await pixels(page, await exportPicture(page, "png", "stress-"), "image/png");
  const scale = big.width / flat.width;
  assert.ok(big.width * big.height <= 4096 * 4096 && scale < 2 && scale > 1, `stress PNG ${big.width} × ${big.height}`);
  assertCrop(big, scale, "stress PNG");

  // Zoomed in and panned so that most of the diagram is off screen: the same picture.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  const moved = await pixels(page, await exportPicture(page, "svg", "stress-zoomed-"), "image/svg+xml");
  assert.deepEqual(moved, flat, "the picture does not depend on the pan and zoom");

  // The openBIS view: the lanes are part of the picture too.
  await open(page, "datastore");
  await page.locator('summary[aria-label="View"]').click();
  await page.getByRole("button", { name: "openBIS view" }).click();
  await page.locator(".react-flow__node-lane").first().waitFor();
  const lanes = await exportPicture(page, "svg");
  assert.ok((lanes.toString("utf8").match(/react-flow__node-lane/g)?.length ?? 0) > 0, "the openBIS lanes are in the picture");

  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".notice").count(), 0, "no error notice");
  console.log(`Picture export check passed${out ? `; pictures in ${out}` : ""}.`);
} finally {
  await browser.close();
}
