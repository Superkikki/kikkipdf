import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

async function openFixture(page: Page, count = 12) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const p = pdf.addPage(i === 4 ? [595, 420] : [420, 595]);
    p.drawText(`Reader page ${i + 1}`, { x: 40, y: p.getHeight() - 75, size: 18 });
    if (i === 1 || i === 8) p.drawText("Find review item", { x: 40, y: p.getHeight() - 110, size: 12 });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "reader.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
}

async function visibleThumbnail(page: Page) {
  return page.locator(".thumbnail.selected").evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const parent = el.closest(".side-scroll")!.getBoundingClientRect();
    return bounds.top >= parent.top && bounds.bottom <= parent.bottom;
  });
}

test("scrolling synchronizes page controls and thumbnails without moving the document", async ({ page }) => {
  await page.goto("/");
  await openFixture(page);
  const sections = page.locator(".viewer-scroll .page-section");
  const input = page.getByLabel("ページ番号", { exact: true });
  await sections.nth(8).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(input).toHaveValue("9");
  await expect(page.locator(".thumbnail").nth(8)).toHaveAttribute("aria-current", "page");
  await expect.poll(() => visibleThumbnail(page)).toBe(true);
  expect(await page.locator(".viewer-scroll canvas").count()).toBeLessThan(8);
  const y = (await sections.nth(8).boundingBox())!.y;
  const top = (await page.locator(".viewer-scroll").boundingBox())!.y;
  expect(Math.abs(y - top)).toBeLessThan(20);
  await page.getByRole("button", { name: "次のページ", exact: true }).click();
  await expect(input).toHaveValue("10");
  await input.fill("12");
  await expect.poll(() => visibleThumbnail(page)).toBe(true);
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await input.fill("3");
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await expect.poll(() => visibleThumbnail(page)).toBe(true);
});

test("zoom steps from the rendered fit percentage, retains the reading position, and fits a whole page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await openFixture(page);
  const zoom = page.getByLabel("ズーム", { exact: true });
  await zoom.selectOption("page");
  const paper = page.locator(".viewer-scroll .page-view").first();
  await expect.poll(async () => (await paper.boundingBox())!.height).toBeLessThan(500);
  const before = (await paper.boundingBox())!;
  const root = (await page.locator(".viewer-scroll").boundingBox())!;
  expect(before.y + before.height).toBeLessThan(root.y + root.height);
  const actualScale = before.width / 420;
  await expect(page.getByLabel("表示倍率")).toHaveText(`${Math.round(actualScale * 100)}%`);
  await page.getByRole("button", { name: "拡大", exact: true }).click();
  const stepped = Math.round((actualScale + 0.25) * 100) / 100;
  await expect(zoom).toHaveValue(String(stepped));
  await expect.poll(async () => (await paper.boundingBox())!.width / 420).toBeCloseTo(stepped, 2);
  await zoom.selectOption("1");
  const third = page.locator(".viewer-scroll .page-section").nth(2);
  await third.evaluate((el) => {
    const viewer = el.closest<HTMLElement>(".viewer-scroll")!;
    viewer.scrollTop += el.getBoundingClientRect().top - viewer.getBoundingClientRect().top + el.clientHeight * 0.4;
  });
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  const fraction = await third.evaluate((el) => (el.closest(".viewer-scroll")!.getBoundingClientRect().top - el.getBoundingClientRect().top) / el.getBoundingClientRect().height);
  await zoom.selectOption("1.5");
  await expect.poll(async () => third.evaluate((el) => (el.closest(".viewer-scroll")!.getBoundingClientRect().top - el.getBoundingClientRect().top) / el.getBoundingClientRect().height)).toBeCloseTo(fraction, 2);
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await zoom.selectOption("width");
  await third.evaluate((el) => {
    const viewer = el.closest<HTMLElement>(".viewer-scroll")!;
    viewer.scrollTop += el.getBoundingClientRect().top - viewer.getBoundingClientRect().top + el.clientHeight * 0.4;
  });
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  const widthBeforeResize = (await third.boundingBox())!.width;
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => (await third.boundingBox())!.width).toBeLessThan(widthBeforeResize);
  await expect.poll(async () => third.evaluate((el) => (el.closest(".viewer-scroll")!.getBoundingClientRect().top - el.getBoundingClientRect().top) / el.getBoundingClientRect().height)).toBeCloseTo(0.4, 2);
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await zoom.selectOption("4");
  await expect(page.getByRole("button", { name: "拡大", exact: true })).toBeDisabled();
  await zoom.selectOption("0.25");
  await expect(page.getByRole("button", { name: "縮小", exact: true })).toBeDisabled();
});

test("Ctrl+F opens and focuses search from a hidden sidebar and Enter traverses results", async ({ page }) => {
  await page.goto("/");
  await openFixture(page);
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await page.keyboard.press("Control+f");
  const search = page.getByLabel("PDF内を検索", { exact: true });
  await expect(search).toBeFocused();
  await expect(page.getByRole("button", { name: "サイドバー", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "次の検索結果", exact: true })).toBeDisabled();
  await search.fill("Find review item");
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  await search.press("Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await search.press("Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("9");
  await search.press("Shift+Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("2");
  await search.press("Shift+Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("9");
  await page.keyboard.press("Control+f");
  await expect(search).toBeFocused();
  expect(await search.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe("Find review item".length);
  await search.fill("No matching phrase");
  await expect(page.locator(".search-count")).toContainText("0 / 0 件");
  await expect(page.locator(".search-panel")).toContainText("一致するテキストがありません。");
  await expect(page.getByRole("button", { name: "次の検索結果", exact: true })).toBeDisabled();
});


test("scrolling away from a selected object clears selection and prevents deletion on another page", async ({ page }) => {
  await page.goto("/");
  await openFixture(page);
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const first = page.locator(".viewer-scroll .page-view").first();
  const bounds = (await first.boundingBox())!;
  await page.mouse.click(bounds.x + 70, bounds.y + 180);
  await page.getByLabel("テキスト内容").fill("Keep this annotation");
  await page.locator(".viewer-scroll .page-section").nth(8).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("9");
  await expect(page.getByLabel("テキスト内容")).toHaveCount(0);
  await page.locator(".document-tab").click();
  await page.keyboard.press("Delete");
  await page.getByLabel("ページ番号", { exact: true }).fill("1");
  await expect(first.locator(".object-layer")).toContainText("Keep this annotation");
});

test("Ctrl+wheel and trackpad pinch zoom only the PDF and retain the cursor location", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, 3);
  const zoom = page.getByLabel("ズーム", { exact: true });
  await zoom.selectOption("1");
  const paper = page.locator(".viewer-scroll .page-view").first();
  const bounds = (await paper.boundingBox())!;
  const point = { x: bounds.x + 200, y: bounds.y + 220 };
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
  const enlarged = Number(await zoom.inputValue());
  const after = (await paper.boundingBox())!;
  expect((point.y - after.y) / after.height).toBeCloseTo((point.y - bounds.y) / bounds.height, 1);
  expect((point.x - after.x) / after.width).toBeCloseTo((point.x - bounds.x) / bounds.width, 1);
  // Precision touchpads deliver pinch as small pixel wheel deltas with ctrlKey.
  await paper.evaluate((el, p) => {
    for (let i = 0; i < 8; i++) el.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: -3, deltaMode: 0,
      clientX: p.x, clientY: p.y,
    }));
  }, point);
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(enlarged);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  const value = await zoom.inputValue();
  await page.mouse.wheel(0, 160);
  await expect.poll(() => page.locator(".viewer-scroll").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(zoom).toHaveValue(value);
  await paper.evaluate(el => el.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100, deltaMode: 1,
  })));
  await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(Number(value));
});

test("pointer drag reorders pages in both directions, supports keyboard and undo, and persists on save", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await openFixture(page, 3);
  const thumbs = page.locator(".thumbnail");
  const ids = await thumbs.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.pageId));
  async function drag(from: number, to: number, edge: "before" | "after") {
    const a = (await thumbs.nth(from).boundingBox())!;
    const b = (await thumbs.nth(to).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * (edge === "before" ? 0.2 : 0.8), { steps: 12 });
    await expect(thumbs.nth(to)).toHaveClass(new RegExp(`drop-${edge}`));
    await page.mouse.up();
  }
  const order = () => thumbs.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.pageId));
  await drag(0, 2, "after");
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);
  await page.keyboard.press("Control+z");
  await expect.poll(order).toEqual(ids);
  await page.keyboard.press("Control+y");
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);
  await drag(2, 0, "before");
  await expect.poll(order).toEqual(ids);
  await thumbs.nth(2).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(order).toEqual([ids[0], ids[2], ids[1]]);
  await page.keyboard.press("Control+z");
  await expect.poll(order).toEqual(ids);
  await drag(2, 0, "before");
  await expect.poll(order).toEqual([ids[2], ids[0], ids[1]]);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const file = info.outputPath("reordered.pdf");
  await (await download).saveAs(file);
  await page.reload();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.locator(".viewer-scroll .textLayer").first()).toContainText("Reader page 3");
});

test("page drag scrolls the thumbnail list and Escape cancels without changing order", async ({ page }) => {
  await page.goto("/");
  await openFixture(page);
  const thumbs = page.locator(".thumbnail");
  const ids = await thumbs.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.pageId));
  const a = (await thumbs.first().boundingBox())!;
  const list = page.locator(".side-scroll");
  const r = (await list.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, r.y + r.height - 12, { steps: 12 });
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(60);
  await page.keyboard.press("Escape");
  await expect(page.locator(".thumbnail.dragging")).toHaveCount(0);
  await expect(page.locator(".thumbnail.drop-before,.thumbnail.drop-after")).toHaveCount(0);
  await page.mouse.up();
  expect(await thumbs.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.pageId))).toEqual(ids);
  await expect(page.getByRole("button", { name: "元に戻す (Ctrl+Z)", exact: true })).toBeDisabled();
});
