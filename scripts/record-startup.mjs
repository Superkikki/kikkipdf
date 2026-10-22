import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Run against `npm run dev`. A real browser capture, including the handoff to the app.
const output = path.resolve("artifacts/ghost-protocol");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    recordVideo: { dir: output, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:1420/");
  await page.locator(".ghost-opening").waitFor();
  await page.waitForTimeout(5800);
  await page.screenshot({ path: path.join(output, "ghost-protocol.png") });
  await page.locator(".ghost-opening").waitFor({ state: "detached", timeout: 12000 });
  await page.getByRole("button", { name: "PDFを開く", exact: true }).waitFor();
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(output, "ghost-protocol.webm"));
  await video.delete();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Recorded: ${path.join(output, "ghost-protocol.webm")}`);
} finally {
  await browser.close();
}
