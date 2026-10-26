import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFRawStream, PDFString, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
async function fixture() {
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 500]);
  page.drawText("Editable text survives compression", { x: 20, y: 470, size: 14 }); pdf.setTitle("Batch title");
  page.drawRectangle({ x: 30, y: 380, width: 180, height: 26, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  page.drawRectangle({ x: 30, y: 330, width: 18, height: 18, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  const pixels = new Uint8Array(800 * 600 * 3); let seed = 1;
  for (let i = 0; i < pixels.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const image = pdf.context.register(pdf.context.flateStream(pixels, { Type: "XObject", Subtype: "Image", Width: 800, Height: 600, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));
  const resources = page.node.Resources()!; resources.set(PDFName.of("XObject"), pdf.context.obj({ Photo: image }));
  page.node.addContentStream(pdf.context.register(pdf.context.stream(new TextEncoder().encode("q 160 0 0 120 220 30 cm /Photo Do Q"))));
  const form = pdf.getForm().createTextField("Existing"); form.addToPage(page, { x: 30, y: 250, width: 180, height: 25 }); form.setText("Value");
  await pdf.attach(new Uint8Array([1, 2, 3]), "keep.bin");
  return Buffer.from(await pdf.save());
}
async function open(page: import("@playwright/test").Page, buffer: Buffer) {
  await page.goto("/"); await page.keyboard.press("Escape"); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles({ name: "source.pdf", mimeType: "application/pdf", buffer });
}
async function fileMenu(page: import("@playwright/test").Page, action: string) {
  await page.locator("summary").filter({ hasText: /^ファイル$/ }).click(); await page.getByRole("button", { name: action, exact: true }).click();
}
test("compresses supported images, preserves forms/text/attachments and saves a separate PDF", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await open(page, await fixture()); await fileMenu(page, "PDF圧縮・最適化");
  const dialog = page.getByRole("dialog", { name: "PDF圧縮・最適化", exact: true }); await expect(dialog.getByLabel("圧縮方法")).toBeFocused();
  await dialog.getByRole("button", { name: "圧縮結果を作成", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("画像の再圧縮: 1件");
  await page.screenshot({ path: info.outputPath("optimization.png") }); const download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "圧縮PDFを保存", exact: true }).click();
  const output = info.outputPath("optimized.pdf"); await (await download).saveAs(output); const bytes = await readFile(output), doc = await PDFDocument.load(bytes);
  expect(doc.getForm().getTextField("Existing").getText()).toBe("Value"); expect(doc.catalog.get(PDFName.of("Names"))).toBeDefined(); expect(bytes.length).toBeLessThan(6000000);
  const images = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter(o => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) as PDFRawStream[];
  expect(images[0].dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode")); expect(images[0].contents.length).toBeLessThan(500000);
  await dialog.getByTitle("閉じる", { exact: true }).click(); await page.reload(); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles(output);
  await expect(page.locator(".textLayer").first()).toContainText("Editable text survives compression"); expect(errors).toEqual([]);
});
test("batch is available without a document, rotates and strips metadata, reports bad files in ZIP", async ({ page }, info) => {
  await page.goto("/"); await page.keyboard.press("Escape"); await fileMenu(page, "複数PDFを一括処理"); const dialog = page.getByRole("dialog", { name: "複数PDFを一括処理", exact: true });
  const chooser = page.waitForEvent("filechooser"); await dialog.getByRole("button", { name: "処理するPDFを選択", exact: true }).click(); await (await chooser).setFiles([{ name: "same.pdf", mimeType: "application/pdf", buffer: await fixture() }, { name: "same.pdf", mimeType: "application/pdf", buffer: await fixture() }, { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not pdf") }]);
  await dialog.getByLabel("全ページの回転").selectOption("90"); await dialog.getByLabel("文書情報（Info・文書レベルXMP）を削除").check(); await dialog.getByRole("button", { name: "一括処理を実行", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("2件成功 / 1件失敗"); await page.screenshot({ path: info.outputPath("batch.png") });
  const download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "結果をZIP保存", exact: true }).click(); const path = info.outputPath("batch.zip"); await (await download).saveAs(path);
  const zip = unzipSync(await readFile(path)); expect(Object.keys(zip)).toEqual(["same-processed.pdf", "same-processed (2).pdf", "report.json"]);
  const doc = await PDFDocument.load(zip["same-processed.pdf"], { updateMetadata: false }); expect(doc.getPage(0).getRotation().angle).toBe(90); expect(doc.getTitle()).toBeUndefined(); expect(doc.getForm().getTextField("Existing").getText()).toBe("Value");
  const report = JSON.parse(new TextDecoder().decode(zip["report.json"])); expect(report.files[2].error).toBeTruthy();
});
test("detects empty boxes, excludes an existing widget, reviews names and saves undoable fields", async ({ page }, info) => {
  await open(page, await fixture()); await page.getByRole("button", { name: "ツール", exact: true }).click(); await page.getByRole("button", { name: "フォーム入力", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "フォーム入力", exact: true });
  await dialog.getByRole("button", { name: "入力枠を自動検出", exact: true }).click(); await dialog.getByRole("button", { name: "現在のページから入力枠を検出", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("2件の候補"); await dialog.getByLabel("候補1の名前", { exact: true }).fill("DetectedName"); await expect(dialog.getByLabel("候補2の種類", { exact: true })).toHaveValue("checkbox");
  await page.screenshot({ path: info.outputPath("form-detection.png") }); await dialog.getByRole("button", { name: "選択した候補をフォームに追加（2件）", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("2件を追加");
  await dialog.getByRole("button", { name: "完了", exact: true }).click(); await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click(); await page.getByTitle("やり直す (Ctrl+Y)", { exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click(); const path = info.outputPath("detected.pdf"); await (await download).saveAs(path);
  const doc = await PDFDocument.load(await readFile(path)); expect(doc.getForm().getFields()).toHaveLength(3); expect(doc.getForm().getTextField("DetectedName").getText() ?? "").toBe("");
  const widget = doc.getForm().getTextField("DetectedName").acroField.getWidgets()[0].getRectangle(); expect(widget.x).toBeCloseTo(30, -1); expect(widget.y).toBeCloseTo(380, -1);
});
test("rejects signed PDFs in batch, keeps small-window controls visible", async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.context.register(pdf.context.obj({ Type: "Sig", Contents: PDFString.of("signed") }));
  await page.setViewportSize({ width: 960, height: 600 }); await page.goto("/"); await page.keyboard.press("Escape"); await fileMenu(page, "複数PDFを一括処理"); const dialog = page.getByRole("dialog", { name: "複数PDFを一括処理", exact: true });
  const chooser = page.waitForEvent("filechooser"); await dialog.getByRole("button", { name: "処理するPDFを選択", exact: true }).click(); await (await chooser).setFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(dialog.getByRole("button", { name: "一括処理を実行", exact: true })).toBeInViewport(); await dialog.getByRole("button", { name: "一括処理を実行", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("0件成功 / 1件失敗"); await expect(dialog.getByRole("table")).toContainText("電子署名"); await expect(dialog.getByRole("button", { name: "結果をZIP保存", exact: true })).toBeDisabled();
});
test("cancels a batch without exposing partial output and can run it again", async ({ page }) => {
  await page.goto("/"); await page.keyboard.press("Escape"); await fileMenu(page, "複数PDFを一括処理"); const dialog = page.getByRole("dialog", { name: "複数PDFを一括処理", exact: true });
  const buffer = await fixture(), chooser = page.waitForEvent("filechooser"); await dialog.getByRole("button", { name: "処理するPDFを選択", exact: true }).click(); await (await chooser).setFiles(Array.from({ length: 8 }, (_, i) => ({ name: `${i}.pdf`, mimeType: "application/pdf", buffer })));
  await dialog.getByRole("button", { name: "一括処理を実行", exact: true }).click(); await dialog.getByRole("button", { name: "処理をキャンセル", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("キャンセルしました"); await expect(dialog.getByRole("button", { name: "結果をZIP保存", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "一括処理を実行", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("8件成功 / 0件失敗");
});
test("detects scanned boxes on a rotated/cropped page and avoids duplicate fields", async ({ page }) => {
  await page.goto("/"); await page.keyboard.press("Escape");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 500; const ctx = c.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0, 0, 400, 500); ctx.strokeStyle = "black"; ctx.lineWidth = 1; ctx.strokeRect(30, 94, 180, 26); ctx.strokeRect(30, 152, 18, 18);
    return Array.from(new Uint8Array(await (await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!)))).arrayBuffer()));
  });
  const pdf = await PDFDocument.create(), p = pdf.addPage([450, 550]), image = await pdf.embedPng(new Uint8Array(png)); p.drawImage(image, { x: 25, y: 25, width: 400, height: 500 }); p.setCropBox(25, 25, 400, 500);
  p.node.set(PDFName.of("Rotate"), pdf.context.obj(90)); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "ツール", exact: true }).click(); await page.getByRole("button", { name: "フォーム入力", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "フォーム入力", exact: true }); await dialog.getByRole("button", { name: "入力枠を自動検出", exact: true }).click(); await dialog.getByRole("button", { name: "現在のページから入力枠を検出", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("件の候補");
  await expect(dialog.getByRole("status")).toContainText("2件の候補"); await dialog.getByRole("button", { name: "選択した候補をフォームに追加（2件）", exact: true }).click();
  await dialog.getByRole("button", { name: "現在のページから入力枠を検出", exact: true }).click(); await expect(dialog.getByRole("status")).toContainText("0件の候補");
});
