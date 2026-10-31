import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, rgb, StandardFonts, degrees, PDFName } from "pdf-lib";
import { readFile } from "node:fs/promises";

async function fixture(candidate = false) {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const second = pdf.addPage([300, 400]);
  if (candidate) second.drawRectangle({ x: 70, y: 240, width: 55, height: 35, color: rgb(0.9, 0.1, 0.2) });
  if (candidate) pdf.addPage([320, 400]);
  else pdf.addPage([300, 400]);
  if (candidate) pdf.addPage([300, 400]);
  return Buffer.from(await pdf.save());
}

async function open(page: Page, buffer: Buffer, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
}

test("compares unsaved edits, rectangles, page sizes and counts, then saves a report", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await open(page, await fixture(), "left.pdf");

  // This rectangle only exists in the editor. The original source remains unchanged.
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const box = await page.locator(".viewer-scroll .page-view").first().boundingBox();
  if (!box) throw new Error("missing first page");
  await page.mouse.move(box.x + 55, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 115, box.y + 115);
  await page.mouse.up();
  await expect(page.locator(".viewer-scroll .object-layer g[data-object-id]")).toHaveCount(1);

  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "PDF比較", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PDF比較" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "比較するPDFを選ぶ" }).click();
  await (await chooser).setFiles({ name: "right.pdf", mimeType: "application/pdf", buffer: await fixture(true) });
  await dialog.getByRole("button", { name: "比較を実行" }).click();

  const status = dialog.getByRole("status");
  await expect(status).toContainText("比較完了：4ページ中4ページに変更");
  const pages = dialog.getByRole("navigation", { name: "比較ページ" });
  await expect(pages.getByRole("button", { name: /ページ1 · 変更あり/ })).toBeVisible();
  await expect(pages.getByRole("button", { name: /ページ2 · 変更あり/ })).toBeVisible();
  await expect(pages.getByRole("button", { name: /ページ3 · 変更あり（サイズ変更）/ })).toBeVisible();
  await expect(pages.getByRole("button", { name: /ページ4 · 追加/ })).toBeVisible();
  await expect(dialog.getByLabel("差分", { exact: true })).toBeVisible();
  await expect.poll(() => dialog.locator("canvas[aria-label='差分']").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("pdf-comparison.png") });

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "比較レポートを保存" }).click();
  const reportPath = info.outputPath("comparison.json");
  await (await download).saveAs(reportPath);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  expect(report.pageMatching).toBe("position");
  expect(report.pages.map((p: { status: string }) => p.status)).toEqual(["changed", "changed", "changed", "added"]);
  expect(report.pages.slice(0, 2).every((p: { changedPixels: number; regions: unknown[] }) => p.changedPixels > 0 && p.regions.length > 0)).toBe(true);
  expect(report.pages[2].sizeChanged).toBe(true);
  expect(report.pages[2].leftSize.width).not.toBe(report.pages[2].rightSize.width);
  await expect(page.locator(".thumbnail")).toHaveCount(3);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewer-scroll .object-layer g[data-object-id]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("compares identical cropped and rotated text pages, filters unchanged rows, then reports a missing tail page", async ({ page }, info) => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  const first = source.addPage([300, 400]);
  first.drawText("Real searchable PDF text", { x: 30, y: 320, size: 16, font });
  const second = source.addPage([360, 460]);
  second.drawText("Rotated and cropped", { x: 40, y: 370, size: 14, font });
  second.setCropBox(20, 30, 320, 420);
  second.setRotation(degrees(90));
  source.addPage([300, 400]);
  const sourceBytes = Buffer.from(await source.save());
  const shorter = await PDFDocument.create();
  const copied = await shorter.copyPages(await PDFDocument.load(sourceBytes), [0, 1]);
  copied.forEach(p => shorter.addPage(p));
  const shorterBytes = Buffer.from(await shorter.save());

  await page.goto("/");
  await open(page, sourceBytes, "text-source.pdf");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "PDF比較", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PDF比較" });
  const choose = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "比較するPDFを選ぶ" }).click();
    await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
  };
  await choose("identical.pdf", sourceBytes);
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：3ページ中0ページに変更");
  const nav = dialog.getByRole("navigation", { name: "比較ページ" });
  await expect(nav.getByRole("button", { name: /ページ1 · 変更なし/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /ページ2 · 変更なし/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /ページ3 · 変更なし/ })).toBeVisible();
  await dialog.getByLabel("変更のあるページだけ表示").check();
  await expect(nav.getByText("変更はありません。")).toBeVisible();
  await expect(nav.getByRole("button")).toHaveCount(0);

  await choose("shorter.pdf", shorterBytes);
  await dialog.getByLabel("比較解像度").selectOption("144");
  await dialog.getByLabel("感度").selectOption("8");
  await expect(nav.getByRole("button")).toHaveCount(0);
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：3ページ中1ページに変更");
  await expect(nav.getByRole("button", { name: /ページ1 · 変更なし/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /ページ2 · 変更なし/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /ページ3 · 削除/ })).toBeVisible();
  await expect.poll(() => dialog.locator("canvas[aria-label='差分']").evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("pdf-comparison-identical-and-removed.png") });
});

test("cancels an active comparison and closes the dialog without changing pages", async ({ page }) => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 40; i++) pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save());
  await page.goto("/");
  await open(page, bytes, "many-pages.pdf");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "PDF比較", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PDF比較" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "比較するPDFを選ぶ" }).click();
  await (await chooser).setFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: bytes });
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較を中止しました");
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：40ページ中0ページに変更", { timeout: 30000 });
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".thumbnail")).toHaveCount(40);
});

async function textFixture(texts: string[], invisible = false) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const sheet = pdf.addPage([300, 400]);
    if (invisible) {
      sheet.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font.ref } }));
      sheet.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
        `BT /F1 ${text.length > 20000 ? 0.001 : 12} Tf 3 Tr 40 320 Td (${text}) Tj ET`,
      )));
    } else sheet.drawText(text, { x: 40, y: 320, size: 16, font });
  }
  return Buffer.from(await pdf.save());
}

async function compareDialog(page: Page, bytes: Buffer) {
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "PDF比較", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "PDF比較" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "比較するPDFを選ぶ" }).click();
  await (await chooser).setFiles({ name: "candidate.pdf", mimeType: "application/pdf", buffer: bytes });
  return dialog;
}

test("compares invisible text, missing pages and unchanged text, and includes text in the report", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await open(page, await textFixture(["Same text", "Price 100", "Removed tail"], true), "hidden-text.pdf");
  const dialog = await compareDialog(page, await textFixture(["Same text", "Price 200"], true));
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：3ページ中1ページに変更");
  await expect(dialog.getByRole("region", { name: "文字差分", exact: true })).toHaveCount(0);
  await dialog.getByLabel("文字差分も比較する").check();
  await expect(dialog.getByRole("button", { name: "比較レポートを保存" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：3ページ中2ページに変更");
  const text = dialog.getByRole("region", { name: "文字差分", exact: true });
  await expect(text).toContainText("比較対象で追加 1文字・削除 1文字");
  await expect(text.locator("del")).toHaveText("1"); await expect(text.locator("ins")).toHaveText("2");
  const download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "比較レポートを保存" }).click();
  const path = info.outputPath("text-comparison.json"); await (await download).saveAs(path);
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.textComparison).toBe(true); expect(report.textCountUnits).toBe("unicode-code-points");
  expect(report.pages.map((p: { status: string }) => p.status)).toEqual(["same", "changed", "removed"]);
  expect(report.pages[1].changedPixels).toBe(0);
  expect(report.pages[1].text).toMatchObject({ changed: true, added: 1, removed: 1, simplified: false });
  expect(report.pages[2].text.changes).toEqual([{ kind: "removed", text: "Removed tail" }]);
  await dialog.getByRole("button", { name: /ページ1 · 変更なし/ }).click();
  await expect(text).toContainText("文字の変更はありません。");
  await dialog.getByLabel("変更のあるページだけ表示").check();
  await expect(dialog.getByRole("navigation", { name: "比較ページ" }).getByRole("button")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("text-comparison.png") });
  expect(errors).toEqual([]);
});

test("includes unsaved direct text edits in text comparison and preserves their undo history", async ({ page }) => {
  const original = await textFixture(["Price 100"]);
  await page.goto("/"); await open(page, original, "unsaved-text.pdf");
  await page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Price 100$/ }).dblclick();
  const editor = page.getByRole("textbox", { name: "ページ上のテキスト編集", exact: true });
  await editor.fill("Price 300"); await editor.press("Enter");
  const dialog = await compareDialog(page, original);
  await dialog.getByLabel("文字差分も比較する").check();
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：1ページ中1ページに変更");
  const text = dialog.getByRole("region", { name: "文字差分", exact: true });
  await expect(text.locator("del")).toHaveText("3"); await expect(text.locator("ins")).toHaveText("1");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewer-scroll .editable-text")).toHaveText("Price 100");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Price 100$/ })).toBeVisible();
  await expect(page.locator(".viewer-scroll .editable-text")).toHaveCount(0);
});

test("rejects oversized page text without partial results and allows a visual-only retry", async ({ page }) => {
  await page.goto("/"); await open(page, await textFixture(["x".repeat(20001)], true), "large-text.pdf");
  const dialog = await compareDialog(page, await textFixture(["short"], true));
  await dialog.getByLabel("文字差分も比較する").check();
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("alert")).toContainText("20,000文字まで");
  await expect(dialog.getByRole("button", { name: "比較レポートを保存" })).toHaveCount(0);
  await dialog.getByLabel("文字差分も比較する").uncheck();
  await dialog.getByRole("button", { name: "比較を実行" }).click();
  await expect(dialog.getByRole("status")).toContainText("比較完了：1ページ中0ページに変更");
});
