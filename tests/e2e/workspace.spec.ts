import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
async function fixture(count = 3) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const p = pdf.addPage([420, 595]);
    p.drawText(`Kikki fixture page ${i + 1}`, {
      x: 40,
      y: 520,
      font,
      size: 20,
    });
    p.drawText("Find this searchable sentence.", {
      x: 40,
      y: 480,
      font,
      size: 12,
    });
  }
  return Buffer.from(await pdf.save());
}
async function open(page: Page, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer });
  await expect(page.locator(".document-tab")).toContainText("fixture.pdf");
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]").first(),
  ).toBeVisible();
}
test("open, edit pages/text/image/comment, save and reopen actual PDF", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "PDFを、思いどおりに。" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("welcome.png") });
  await open(page, await fixture());
  await expect(page.locator(".thumbnail")).toHaveCount(3);
  await expect(page.locator(".textLayer").first()).toContainText(
    "Kikki fixture page 1",
  );
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  await page.getByRole("button", { name: "複製", exact: true }).click();
  await expect(page.locator(".thumbnail")).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".thumbnail")).toHaveCount(3);
  await page
    .locator(".thumbnail")
    .nth(2)
    .dragTo(page.locator(".thumbnail").nth(0));
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await page.getByLabel("削除するページ範囲").fill("2");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(page.locator(".thumbnail")).toHaveCount(2);
  await page.locator(".thumbnail").first().click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const box = await page
    .locator(".viewer-scroll .page-view")
    .first()
    .boundingBox();
  if (!box) throw Error("missing page");
  await page.mouse.click(box.x + 90, box.y + 170);
  await page.getByLabel("テキスト内容").fill("保存する日本語テキスト");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "画像", exact: true }).click();
  await (await chooser).setFiles("src-tauri/icons/32x32.png");
  await expect(page.locator(".viewer-scroll .object-layer image")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "注釈", exact: true }).click();
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  await page.mouse.click(box.x + 220, box.y + 300);
  await page.getByLabel("テキスト内容").fill("確認してください");
  await page.screenshot({ path: info.outputPath("editor.png") });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const file = await download;
  const path = info.outputPath("edited.pdf");
  await file.saveAs(path);
  const bytes = await readFile(path);
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
  expect(errors).toEqual([]);
  await page.reload();
  await open(page, bytes);
  await expect(page.locator(".textLayer").first()).toContainText(
    "保存する日本語テキスト",
  );
  await page.screenshot({ path: info.outputPath("reopened.png") });
  expect(errors).toEqual([]);
});
test("300-page rendering stays bounded and search jumps to final page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await open(page, await fixture(300));
  await expect(page.locator(".thumbnail")).toHaveCount(300);
  const before = await page.locator(".viewer-scroll canvas").count();
  expect(before).toBeLessThan(8);
  await page.getByLabel("ページ番号").fill("300");
  await expect(
    page
      .locator(".viewer-scroll .page-section")
      .last()
      .locator("[data-rendered=true]"),
  ).toBeVisible();
  expect(await page.locator(".viewer-scroll canvas").count()).toBeLessThan(8);
  expect(await page.locator(".sidebar canvas").count()).toBeLessThan(15);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByLabel("PDF内を検索").fill("fixture page 299");
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  await page.locator(".search-results button").click();
  await expect(page.getByLabel("ページ番号")).toHaveValue("299");
  expect(errors).toEqual([]);
});
test("OCR runs with local assets and creates a searchable text layer", async ({
  page,
}) => {
  test.setTimeout(120000);
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:1420")
    )
      external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await open(page, await fixture(1));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await page.getByLabel("言語", { exact: true }).selectOption("eng");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  await expect(page.locator(".status-message")).toContainText("OCR完了", {
    timeout: 90000,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const f = await download;
  expect(await f.failure()).toBeNull();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test("redaction reconstructs a fresh PDF without source text", async ({
  page,
}, info) => {
  await page.goto("/");
  await open(page, await fixture(1));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "墨消し候補", exact: true }).click();
  const b = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!b) throw Error("missing page");
  const scale = b.width / 420;
  await page.mouse.move(b.x + 30 * scale, b.y + 45 * scale);
  await page.mouse.down();
  await page.mouse.move(b.x + 380 * scale, b.y + 125 * scale);
  await page.mouse.up();
  await page.getByRole("button", { name: "墨消しを適用", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "新しいPDFへ墨消しを適用" })
    .click();
  const f = await download;
  const path = info.outputPath("redacted.pdf");
  await f.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getForm().getFields()).toHaveLength(0);
  expect(pdf.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const resources = pdf.getPage(0).node.Resources();
  expect(resources).toBeDefined();
  await page.reload();
  const recovery = page.getByRole("dialog");
  if (await recovery.isVisible())
    await recovery.getByRole("button", { name: "キャンセル" }).click();
  await open(page, await readFile(path));
  await expect(page.locator(".viewer-scroll .textLayer")).toHaveText("");
});

test("fills a form, replaces existing text, and reads saved Japanese comments", async ({
  page,
}, info) => {
  const pdf = await PDFDocument.create(),
    p = pdf.addPage([420, 595]);
  p.drawText("Replace this text", { x: 40, y: 520, size: 18 });
  const form = pdf.getForm();
  const name = form.createTextField("Name");
  name.setText("Before");
  name.addToPage(p, { x: 40, y: 360, width: 220, height: 25 });
  const check = form.createCheckBox("Accepted");
  check.addToPage(p, { x: 40, y: 320 });
  await page.goto("/");
  await open(page, Buffer.from(await pdf.save()));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("入力済み");
  await page
    .getByRole("dialog")
    .getByLabel("Accepted", { exact: true })
    .check();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.getByRole("button", { name: "見た目の置換", exact: true }).click();
  await page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: "Replace this text" })
    .dblclick();
  await page.getByLabel("テキスト内容").fill("置換後の文字");
  await expect(page.locator(".properties")).toContainText(
    "元の文字情報は残ります",
  );
  await page.getByRole("button", { name: "注釈", exact: true }).click();
  await page.getByRole("button", { name: "付箋", exact: true }).click();
  const box = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!box) throw Error("Missing page");
  await page.mouse.click(box.x + 80, box.y + 280);
  await page.getByLabel("テキスト内容").fill("日本語コメント");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const f = await download;
  const dest = info.outputPath("form.pdf");
  await f.saveAs(dest);
  await page.reload();
  await open(page, await readFile(dest));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Name", { exact: true }),
  ).toHaveValue("入力済み");
  await expect(
    page.getByRole("dialog").getByLabel("Accepted", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "置換後の文字",
  );
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card")).toContainText("日本語コメント");
});
test("recovers unsaved changes after a page reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const b = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!b) throw Error("Missing page");
  await page.mouse.click(b.x + 80, b.y + 100);
  await page.getByLabel("テキスト内容").fill("復旧する内容");
  await page.waitForTimeout(16000);
  await page.reload();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "復元", exact: true })
    .click();
  await expect(page.locator(".viewer-scroll .object-layer")).toContainText(
    "復旧する内容",
  );
  await expect(page.locator(".unsaved-dot")).toBeVisible();
});
