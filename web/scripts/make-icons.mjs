#!/usr/bin/env node
/*
 * Makes the PNG and ICO icons from src/app/icon.svg (the 9:16 frame, ink on volt), so they always
 * match it: public/icon-192.png and icon-512.png (the app manifest; 512 is also the logo in
 * structured data), src/app/icon1.png (192: a sharp favicon for Google's results, which wants a
 * multiple of 48 px), src/app/apple-icon.png (180, full-bleed: iOS rounds it itself) and
 * src/app/favicon.ico (16, 32 and 48). Needs Microsoft Edge (Playwright).
 *   node scripts/make-icons.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile("src/app/icon.svg", "utf8");
// The same mark without the rounded corners, for Apple.
const square = svg.replace(/<rect width="64" height="64" rx="14"/, '<rect width="64" height="64"');
if (square === svg) throw new Error("icon.svg changed shape: update make-icons.mjs");

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

await writeFile("public/icon-192.png", await png(svg, 192));
await writeFile("public/icon-512.png", await png(svg, 512));
await writeFile("src/app/icon1.png", await png(svg, 192));
await writeFile("src/app/apple-icon.png", await png(square, 180));

// An ICO file can hold PNGs: a 6-byte header, a 16-byte entry per image, then the images.
const sizes = [16, 32, 48];
const images = [];
for (const s of sizes) images.push(await png(svg, s));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...images]));
await browser.close();
console.log("✓ public/icon-192.png, public/icon-512.png, src/app/icon1.png, src/app/apple-icon.png, src/app/favicon.ico");
