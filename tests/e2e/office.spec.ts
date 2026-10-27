import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

test("exports editable text from each page as a Word document", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ["First & page", "Second page"]) {
    const sheet = pdf.addPage([420, 595]);
    sheet.drawText(text, { x: 40, y: 520, font, size: 20 });
  }
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const bounds = await page.locator(".viewer-scroll .page-view").first().boundingBox();
  if (!bounds) throw Error("missing page");
  await page.mouse.click(bounds.x + 90, bounds.y + 170);
  await page.getByLabel("テキスト内容").fill("追加した日本語");
  await page.locator(".menu > summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "Word形式で書き出し（テキスト）", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Word形式で書き出し（テキスト）" });
  await expect(dialog).toContainText("元のレイアウトは再現しません");
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "書き出し", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("source.docx");
  const saved = await file.path();
  const files = unzipSync(await readFile(saved));
  const xml = strFromU8(files["word/document.xml"]);
  expect(xml).toContain("First &amp; page");
  expect(xml).toContain("Second page");
  expect(xml).toContain("追加した日本語");
  expect(xml).toContain('<w:br w:type="page"/>');
});

test("refuses Word export while a redaction is still pending", async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([420, 595]).drawText("Confidential content", { x: 40, y: 520, size: 20 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "confidential.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  const canvas = page.locator(".viewer-scroll .page-view[data-rendered=true]").first();
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "墨消し候補", exact: true }).click();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw Error("missing page");
  await page.mouse.move(bounds.x + 30, bounds.y + 45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 300, bounds.y + 130);
  await page.mouse.up();
  await page.locator(".menu > summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "Word形式で書き出し（テキスト）", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("墨消し候補が残っています");
  await expect(page.getByRole("dialog", { name: "Word形式で書き出し（テキスト）" })).toHaveCount(0);
});
