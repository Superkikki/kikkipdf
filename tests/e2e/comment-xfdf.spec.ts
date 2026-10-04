import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFHexString, PDFString } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject } from "../../src/state/project";

const editedText = '編集済み <資料> & "引用"\n日本語の2行目';
const editedAuthor = '山田 & <担当> "レビュー"';
const addedText = '追加コメント <確認> & "日本語"';
const addedAuthor = "追加の担当";

async function open(page: Page, buffer: Buffer, name: string) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: name.endsWith(".kpdf") ? "application/zip" : "application/pdf", buffer });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
}

async function mixedFixture() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([400, 500]), second = pdf.addPage([400, 500]);
  function note(text: string, rect: number[]) {
    first.node.addAnnot(pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Text", Rect: rect, Contents: PDFHexString.fromText(text),
      T: PDFHexString.fromText("元の担当"), StateModel: PDFString.of("Review"),
      State: PDFString.of("Accepted"), P: first.ref, F: 4,
    })));
  }
  note("Original review", [40, 50, 80, 90]);
  note("Delete this review", [100, 100, 124, 124]);
  second.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: "Highlight", Rect: [100, 380, 160, 400],
    QuadPoints: [100, 400, 160, 400, 100, 380, 160, 380],
    Contents: PDFHexString.fromText("蛍光ペンの注釈"), T: PDFHexString.fromText("元の担当"), P: second.ref,
  })));
  const model = emptyDocument("レビュー & 資料.pdf");
  model.sources = { original: { id: "original", name: model.name, bytes: await pdf.save() } };
  model.pages = [0, 1].map(sourceIndex => ({
    ...blankPage(), sourceId: "original", sourceIndex, width: 400, height: 500,
  }));
  model.pages[1].objects = [{
    ...newObject("note", 120, 80), id: "added-note", width: 24, height: 24,
    text: addedText, author: addedAuthor, reviewStatus: "Rejected",
  }];
  return Buffer.from(await saveProject(model));
}

async function parseXfdf(page: Page, xml: string) {
  return page.evaluate(value => {
    const doc = new DOMParser().parseFromString(value, "application/xml");
    return {
      error: doc.querySelector("parsererror")?.textContent ?? null,
      root: doc.documentElement.localName,
      namespace: doc.documentElement.namespaceURI,
      file: doc.querySelector("f")?.getAttribute("href"),
      annotations: Array.from(doc.querySelector("annots")?.children ?? []).map(annotation => ({
        kind: annotation.localName,
        attributes: Object.fromEntries(Array.from(annotation.attributes).map(attribute => [attribute.name, attribute.value])),
        contents: annotation.querySelector("contents")?.textContent,
      })),
    };
  }, xml);
}

test("exports live imported and added comments as valid XFDF with original coordinates and preserves undo history", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await open(page, await mixedFixture(), "mixed-comments.kpdf");
  const cards = page.locator(".comment-card");
  await expect(cards).toHaveCount(4);
  await cards.filter({ hasText: "Original review" }).click();
  await page.getByLabel("コメント内容", { exact: true }).fill(editedText);
  await page.getByRole("textbox", { name: "コメントの作成者", exact: true }).fill(editedAuthor);
  await page.getByLabel("コメントのレビュー状態", { exact: true }).selectOption("Completed");
  await cards.filter({ hasText: "Delete this review" }).click();
  await page.getByRole("button", { name: "コメントを削除", exact: true }).click();
  await expect(cards).toHaveCount(3);
  const dirtyBefore = await page.locator(".unsaved-dot").count();
  const undo = page.getByRole("button", { name: /^元に戻す/ });
  const redo = page.getByRole("button", { name: /^やり直す/ });
  await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled();
  const allDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "全件をXFDF保存", exact: true }).click();
  const all = await allDownload;
  expect(all.suggestedFilename()).toMatch(/\.xfdf$/);
  const allPath = info.outputPath("comments-all.xfdf"); await all.saveAs(allPath);
  const xml = (await readFile(allPath)).toString("utf8");
  const parsed = await parseXfdf(page, xml);
  expect(parsed.error).toBeNull(); expect(parsed.root).toBe("xfdf");
  expect(parsed.namespace).toBe("http://ns.adobe.com/xfdf/");
  expect(parsed.file).toBe("レビュー & 資料.pdf");
  expect(parsed.annotations).toHaveLength(3);
  expect(xml).toContain("&lt;"); expect(xml).toContain("&amp;");
  expect(xml).not.toContain("Delete this review");
  const edited = parsed.annotations.find(annotation => annotation.contents === editedText)!;
  expect(edited.kind).toBe("text");
  expect(edited.attributes).toMatchObject({ page: "0", title: editedAuthor, state: "Completed", statemodel: "Review" });
  expect(edited.attributes.rect.split(",").map(Number)).toEqual([40, 50, 80, 90]);
  const added = parsed.annotations.find(annotation => annotation.contents === addedText)!;
  expect(added.kind).toBe("text");
  expect(added.attributes).toMatchObject({ page: "1", title: addedAuthor, state: "Rejected", statemodel: "Review" });
  expect(added.attributes.rect.split(",").map(Number)).toEqual([120, 396, 144, 420]);
  const highlight = parsed.annotations.find(annotation => annotation.contents === "蛍光ペンの注釈")!;
  expect(highlight.kind).toBe("highlight");
  expect(highlight.attributes.page).toBe("1");
  expect(highlight.attributes.rect.split(",").map(Number)).toEqual([100, 380, 160, 400]);
  expect(highlight.attributes.coords.split(",").map(Number)).toEqual([100, 400, 160, 400, 100, 380, 160, 380]);
  expect(new Set(parsed.annotations.map(annotation => annotation.attributes.name)).size).toBe(3);
  await page.getByLabel("コメントの作成者で絞り込み").selectOption({ label: addedAuthor });
  await page.getByLabel("コメントの状態で絞り込み").selectOption("Rejected");
  await page.getByLabel("コメントのページで絞り込み").selectOption({ label: "ページ 2" });
  await expect(cards).toHaveCount(1);
  const filteredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "絞り込み結果をXFDF保存", exact: true }).click();
  const filteredPath = info.outputPath("comments-filtered.xfdf"); await (await filteredDownload).saveAs(filteredPath);
  const filtered = await parseXfdf(page, (await readFile(filteredPath)).toString("utf8"));
  expect(filtered.error).toBeNull(); expect(filtered.annotations).toEqual([added]);
  await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBefore);
  await expect(redo).toBeDisabled();
  await page.getByRole("button", { name: "絞り込みを解除", exact: true }).click();
  await undo.click();
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: "Delete this review" })).toBeVisible();
  await undo.click();
  await cards.filter({ hasText: editedText }).click();
  await expect(page.getByLabel("コメントのレビュー状態", { exact: true })).toHaveValue("Accepted");
  expect(errors).toEqual([]);
});

test("exports beyond the 100-card limit and filters the last comment without dirtying the PDF", async ({ page }, info) => {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([400, 500]);
  for (let i = 0; i < 105; i++) sheet.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [10, 10, 34, 34],
    Contents: PDFHexString.fromText(`Review ${i + 1}`),
    T: PDFHexString.fromText(i === 104 ? "最後の担当" : "Reviewer"), P: sheet.ref,
  })));
  await open(page, Buffer.from(await pdf.save()), "many-xfdf.pdf");
  await expect(page.locator(".comment-card")).toHaveCount(100);
  const allDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "全件をXFDF保存", exact: true }).click();
  const allPath = info.outputPath("comments-105.xfdf"); await (await allDownload).saveAs(allPath);
  const all = await parseXfdf(page, (await readFile(allPath)).toString("utf8"));
  expect(all.error).toBeNull(); expect(all.annotations).toHaveLength(105);
  expect(all.annotations.at(-1)?.contents).toBe("Review 105");
  await page.getByLabel("コメントを検索", { exact: true }).fill("Review 105");
  await expect(page.locator(".comment-card")).toHaveCount(1);
  const filteredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "絞り込み結果をXFDF保存", exact: true }).click();
  const filteredPath = info.outputPath("comments-last.xfdf"); await (await filteredDownload).saveAs(filteredPath);
  const filtered = await parseXfdf(page, (await readFile(filteredPath)).toString("utf8"));
  expect(filtered.error).toBeNull(); expect(filtered.annotations).toEqual([all.annotations.at(-1)]);
  await page.getByLabel("コメントを検索", { exact: true }).fill("missing");
  await expect(page.getByRole("button", { name: "絞り込み結果をXFDF保存", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "全件をXFDF保存", exact: true })).toBeEnabled();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^元に戻す/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^やり直す/ })).toBeDisabled();
});

test("reports unsupported comment types without downloading a partial XFDF and can export a supported filter", async ({ page }, info) => {
  const pdf = await PDFDocument.create(), sheet = pdf.addPage([400, 500]);
  for (const [subtype, text] of [["Text", "Supported review"], ["Stamp", "Unsupported stamp"]]) {
    sheet.node.addAnnot(pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: subtype, Rect: [40, 50, 100, 100],
      Contents: PDFHexString.fromText(text), P: sheet.ref,
    })));
  }
  await open(page, Buffer.from(await pdf.save()), "unsupported-comments.pdf");
  await expect(page.locator(".comment-card")).toHaveCount(2);
  const blockedDownload = page.waitForEvent("download", { timeout: 1000 }).catch(() => null);
  await page.getByRole("button", { name: "全件をXFDF保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/Stamp|スタンプ|未対応|対応していない/);
  expect(await blockedDownload).toBeNull();
  await expect(page.getByRole("button", { name: "全件をXFDF保存", exact: true })).toBeEnabled();
  await page.getByLabel("コメントの種類で絞り込み", { exact: true }).selectOption("xfdf");
  await expect(page.locator(".comment-card")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "絞り込み結果をXFDF保存", exact: true }).click();
  const path = info.outputPath("supported-filter.xfdf"); await (await download).saveAs(path);
  const parsed = await parseXfdf(page, (await readFile(path)).toString("utf8"));
  expect(parsed.error).toBeNull(); expect(parsed.annotations).toHaveLength(1);
  expect(parsed.annotations[0].contents).toBe("Supported review");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^元に戻す/ })).toBeDisabled();
});
