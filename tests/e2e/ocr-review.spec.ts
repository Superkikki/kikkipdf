import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject, saveProject } from "../../src/state/project";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
test("reviews a scanned OCR result, saves corrected transparent text, and restores review state", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 800, 400);
    ctx.font = "40px Arial";
    ctx.fillStyle = "black";
    ctx.fillText("KIKKI OCR SCAN", 60, 110);
    return c.toDataURL("image/png");
  });
  const source = await PDFDocument.create(),
    sheet = source.addPage([400, 200]);
  sheet.drawImage(await source.embedPng(image), {
    x: 0,
    y: 0,
    width: 400,
    height: 200,
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  const canvas = page.locator(
    ".viewer-scroll .page-view[data-rendered=true] canvas",
  );
  await expect(canvas).toBeVisible();
  const originalPixels = await canvas.evaluate((c) =>
    (c as HTMLCanvasElement).toDataURL(),
  );
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
  await page.getByRole("button", { name: "OCR校正", exact: true }).click();
  await expect(page.locator(".ocr-row").first()).toContainText("KIKKI");
  await page.locator(".ocr-row").first().click();
  await expect(page.locator(".viewer-scroll .ocr-region")).toHaveCount(1);
  await page.getByLabel("テキスト内容").fill("CORRECTED OCR TEXT");
  await page
    .getByRole("button", { name: "確認済みにする", exact: true })
    .click();
  await expect(page.locator(".ocr-summary")).toContainText("1 / 1");
  await page.screenshot({ path: info.outputPath("ocr-proofreading.png") });
  await page
    .getByRole("button", { name: "対象ページのOCRを削除", exact: true })
    .click();
  await expect(page.locator(".ocr-row")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".ocr-row")).toHaveCount(1);
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("review.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(restored.pages[0].objects[0]).toMatchObject({
    kind: "ocr",
    text: "CORRECTED OCR TEXT",
    ocrReviewed: true,
    opacity: 0,
  });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const pdf = info.outputPath("reviewed.pdf");
  await (await download).saveAs(pdf);
  await page.reload();
  const reopened = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopened).setFiles(pdf);
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "CORRECTED OCR TEXT",
  );
  await expect(page.locator(".ocr-region")).toHaveCount(0);
  expect(
    await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL()),
  ).toBe(originalPixels);
  await page.setViewportSize({ width: 900, height: 720 });
  await page.getByRole("button", { name: "OCR校正", exact: true }).click();
  await page.screenshot({ path: info.outputPath("reviewed-scan.png") });
  expect(errors).toEqual([]);
});
test("bounds the OCR review list to 100 rows and pages through large recognition results", async ({
  page,
}) => {
  const model = emptyDocument("many-lines.pdf");
  model.pages = [blankPage()];
  model.pages[0].objects = Array.from({ length: 205 }, (_, i) => ({
    ...newObject("ocr", 10, 20),
    text: `OCR line ${i + 1}`,
    opacity: 0,
    ocrConfidence: 60,
  }));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "review.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(model)),
  });
  await page.getByRole("button", { name: "OCR校正", exact: true }).click();
  await expect(page.locator(".ocr-row")).toHaveCount(100);
  await page.getByRole("button", { name: "次のOCR結果" }).click();
  await expect(page.locator(".ocr-row").first()).toContainText("OCR line 101");
  await page.getByRole("button", { name: "次のOCR結果" }).click();
  await expect(page.locator(".ocr-row")).toHaveCount(5);
  await page.getByLabel("認識結果を絞り込む").fill("line 205");
  await expect(page.locator(".ocr-row")).toHaveCount(1);
});
