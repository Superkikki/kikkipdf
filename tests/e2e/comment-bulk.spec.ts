import { test, expect } from "@playwright/test";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";

test("reviews and changes authors beyond 100 cards, deletes a filtered batch with cancel/undo, and saves PDF/project", async ({ page }, info) => {
  const pdf = await PDFDocument.create(), sheet = pdf.addPage();
  for (let i = 0; i < 107; i++) sheet.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: i === 105 ? "Highlight" : "Text", Rect: [30, 30, 50, 50], P: sheet.ref,
    Contents: PDFHexString.fromText(i === 106 ? "Unchanged" : i === 105 ? "Batch highlight" : `Batch ${i + 1}`),
    T: PDFHexString.fromText(i === 106 ? "Other" : "Reviewer"),
    ...(i === 105 ? { QuadPoints: [30, 50, 50, 50, 30, 30, 50, 30] } : {}),
  })));
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "batch.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  const cards = page.locator(".comment-card"), query = page.getByLabel("コメントを検索", { exact: true });
  await expect(cards).toHaveCount(100); await query.fill("Batch");
  await page.getByLabel("一括レビュー状態", { exact: true }).selectOption("Completed");
  await page.getByRole("button", { name: "メモ注釈105件を一括レビュー", exact: true }).click();
  await query.fill("Batch 105"); await expect(cards).toHaveCount(1); await expect(cards).toContainText("完了");
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click(); await expect(cards).toContainText("未確認");
  await page.getByTitle("やり直す (Ctrl+Y)", { exact: true }).click(); await expect(cards).toContainText("完了");
  await query.fill("Batch");
  await page.getByRole("button", { name: "作成者を一括変更", exact: true }).click();
  await page.getByLabel("一括変更する作成者", { exact: true }).fill("Review Team");
  await page.getByRole("dialog").getByRole("button", { name: "適用", exact: true }).click();
  await query.fill("Batch 105"); await expect(cards).toContainText("Review Team"); await query.fill("Batch");
  let download = page.waitForEvent("download"); await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("batch.kpdf"); await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.values(restored.pages[0].annotationEdits!).filter(edit => edit.author === "Review Team")).toHaveLength(106);
  await page.getByRole("button", { name: "絞り込み結果を一括削除", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("106件");
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル", exact: true }).click(); await expect(cards).toHaveCount(100);
  await page.getByRole("button", { name: "絞り込み結果を一括削除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click(); await expect(cards).toHaveCount(0);
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click(); await expect(cards).toHaveCount(100);
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("reviewed.pdf"); await (await download).saveAs(output);
  const saved = await PDFDocument.load(await readFile(output)), annots = saved.getPage(0).node.Annots()!;
  const names = (value: string) => PDFName.of(value);
  expect(annots.size()).toBe(107);
  const last = annots.lookup(104, PDFDict);
  expect(last.lookup(names("T"), PDFHexString).decodeText()).toBe("Review Team");
  expect(last.lookup(names("State"), PDFString).decodeText()).toBe("Completed");
  expect(annots.lookup(105, PDFDict).has(names("State"))).toBe(false);
  expect(annots.lookup(106, PDFDict).lookup(names("T"), PDFHexString).decodeText()).toBe("Other");
  expect(errors).toEqual([]);
});
