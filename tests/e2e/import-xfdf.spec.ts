import { expect, test, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, degrees } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";

const markupXml = `<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><f href="ignored-reference.pdf"/><fields/><annots>
  <text page="0" rect="50,380,90,420" name="same-name" title="山田 &amp; 担当" color="#ffcc33" icon="Comment" statemodel="Review" state="Accepted"><contents>メモ &lt;重要&gt; &amp; &#10;2行目</contents></text>
  <highlight page="0" rect="100,340,180,390" name="quad-mark" title="校正者" color="#ffff00" opacity="0.4" width="2" coords="100,390,140,390,100,370,140,370,140,360,180,360,140,340,180,340"><contents>複数範囲</contents></highlight>
  <underline page="0" rect="200,360,260,380" name="under" color="#ff0000" coords="200,380,260,380,200,360,260,360"><contents>下線</contents></underline>
  <strikeout page="1" rect="45,300,125,320" name="strike" color="#263445" coords="45,320,125,320,45,300,125,300"><contents>取り消し線</contents></strikeout>
  <ink page="1" rect="150,280,220,350" name="ink" title="手描き担当" color="#123456" width="3"><contents>筆跡</contents><inklist><gesture>150,350;180,330;200,310</gesture><gesture>220,280</gesture></inklist></ink>
</annots></xfdf>`;

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([400, 500]);
  const second = pdf.addPage([400, 500]);
  first.setCropBox(20, 30, 350, 450); first.setRotation(degrees(90));
  second.setCropBox(10, 15, 360, 460); second.setRotation(degrees(270));
  first.node.addAnnot(pdf.context.register(pdf.context.obj({
    Type: "Annot", Subtype: "Text", Rect: [25, 35, 49, 59], Contents: PDFHexString.fromText("Source comment"),
    T: PDFHexString.fromText("Original"), P: first.ref, F: 4,
  })));
  return Buffer.from(await pdf.save());
}

async function openPdf(page: Page, bytes: Buffer) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "cropped-rotated.pdf", mimeType: "application/pdf", buffer: bytes });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
}

async function importXfdf(page: Page, content: string, filename = "comments.xfdf") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "XFDFを読み込む", exact: true }).click();
  await (await chooser).setFiles({ name: filename, mimeType: "application/vnd.adobe.xfdf", buffer: Buffer.from(content, "utf8") });
}
async function importBytes(page: Page, buffer: Buffer, filename: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "XFDFを読み込む", exact: true }).click();
  await (await chooser).setFiles({ name: filename, mimeType: "application/vnd.adobe.xfdf", buffer });
}

function annotationByName(page: PDFDict, name: string) {
  const annotations = page.lookup(PDFName.of("Annots"), PDFArray);
  for (let i = 0; i < annotations.size(); i++) {
    const annotation = annotations.lookup(i, PDFDict);
    const identity = annotation.lookupMaybe(PDFName.of("NM"), PDFHexString)?.decodeText();
    if (identity === name) return annotation;
  }
  throw Error(`annotation not found: ${name}`);
}
function numericArray(dict: PDFDict, key: string) {
  const array = dict.lookup(PDFName.of(key), PDFArray);
  return Array.from({ length: array.size() }, (_, index) => array.lookup(index, PDFNumber).asNumber());
}

test("imports five XFDF types atomically, displays and undoes once, and round-trips project/PDF geometry", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const input = await sourcePdf();
  await openPdf(page, input);
  await importXfdf(page, markupXml);
  const layer = page.locator(".imported-markup-layer");
  await expect(layer.locator("[data-subtype]")).toHaveCount(3);
  await expect(layer.locator('[data-subtype="Text"]')).toHaveCount(1);
  await expect(layer.locator('[data-subtype="Highlight"]')).toHaveCount(1);
  await expect(layer.locator('[data-subtype="Underline"]')).toHaveCount(1);
  const importedNote = page.locator(".comment-card").filter({ hasText: "メモ <重要> &" });
  await expect(importedNote).toContainText("山田 & 担当");
  await expect(importedNote).toContainText("承認");
  const undo = page.getByRole("button", { name: /^元に戻す/ });
  const redo = page.getByRole("button", { name: /^やり直す/ });
  await expect(undo).toBeEnabled(); await expect(redo).toBeDisabled();
  const inkCard = page.locator(".comment-card").filter({ hasText: "筆跡" });
  await inkCard.click();
  await expect(layer.locator("[data-subtype]")).toHaveCount(2);
  await expect(layer.locator('[data-subtype="StrikeOut"]')).toHaveCount(1);
  await expect(layer.locator('[data-subtype="Ink"]')).toHaveCount(1);
  await undo.click(); await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(0);
  await redo.click(); await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(2);
  await inkCard.click();
  await page.getByLabel("コメント内容", { exact: true }).fill("筆跡を編集");
  await page.getByRole("textbox", { name: "コメントの作成者", exact: true }).fill("変更後の担当");
  await page.getByRole("button", { name: "コメントを削除", exact: true }).click();
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(1);
  await undo.click();
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(2);
  await expect(page.locator(".comment-card").filter({ hasText: "筆跡を編集" })).toContainText("変更後の担当");

  const projectDownload = page.waitForEvent("download");
  await page.getByText("ファイル", { exact: true }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const projectPath = info.outputPath("imported-markups.kpdf");
  await (await projectDownload).saveAs(projectPath);
  const project = await openProject(new Uint8Array(await readFile(projectPath)));
  expect(project.pages.map(value => value.importedMarkups?.length ?? 0)).toEqual([3, 2]);
  expect(Buffer.from(project.sources[Object.keys(project.sources)[0]].bytes)).toEqual(input);
  expect(project.pages[0].importedMarkups?.find(markup => markup.subtype === "Text")).toMatchObject({
    text: "メモ <重要> & \n2行目", author: "山田 & 担当", reviewStatus: "Accepted", name: "same-name",
  });

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const pdfPath = info.outputPath("imported-markups.pdf");
  await (await pdfDownload).saveAs(pdfPath);
  const output = await PDFDocument.load(new Uint8Array(await readFile(pdfPath)));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPage(0).node.Annots()?.size()).toBe(4);
  expect(output.getPage(1).node.Annots()?.size()).toBe(2);
  const textId = project.pages[0].importedMarkups?.find(markup => markup.subtype === "Text")!.id;
  const quadId = project.pages[0].importedMarkups?.find(markup => markup.subtype === "Highlight")!.id;
  const strikeId = project.pages[1].importedMarkups?.find(markup => markup.subtype === "StrikeOut")!.id;
  const inkId = project.pages[1].importedMarkups?.find(markup => markup.subtype === "Ink")!.id;
  expect(annotationByName(output.getPage(0).node, textId!).lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe("メモ <重要> & \n2行目");
  expect(numericArray(annotationByName(output.getPage(0).node, quadId!), "QuadPoints")).toEqual([100, 390, 140, 390, 100, 370, 140, 370, 140, 360, 180, 360, 140, 340, 180, 340]);
  expect(numericArray(annotationByName(output.getPage(1).node, strikeId!), "QuadPoints")).toEqual([45, 320, 125, 320, 45, 300, 125, 300]);
  expect(annotationByName(output.getPage(1).node, inkId!).lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe("筆跡を編集");
  const ink = annotationByName(output.getPage(1).node, inkId!).lookup(PDFName.of("InkList"), PDFArray);
  expect(ink.size()).toBe(2);
  expect(output.getPage(0).node.Annots()?.lookup(0, PDFDict).lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe("Source comment");
  expect(errors).toEqual([]);

  await page.reload();
  const reopenedProject = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopenedProject).setFiles({ name: "imported-markups.kpdf", mimeType: "application/zip", buffer: await readFile(projectPath) });
  await expect(page.locator(".page-view:not(.mini) .imported-markup-layer [data-subtype]")).toHaveCount(3);
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card").filter({ hasText: "筆跡を編集" })).toContainText("変更後の担当");

  await page.reload();
  const reopenedPdf = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopenedPdf).setFiles({ name: "imported-markups.pdf", mimeType: "application/pdf", buffer: await readFile(pdfPath) });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card").filter({ hasText: "筆跡を編集" })).toContainText("変更後の担当");
});

test("rejects invalid files atomically, rejects duplicate names in one file, and allows later name reuse", async ({ page }) => {
  await openPdf(page, await sourcePdf());
  const validOne = `<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><text page="0" rect="40,40,64,64" name="repeat"><contents>one</contents></text></annots></xfdf>`;
  await importXfdf(page, validOne);
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(1);
  const invalidFiles = [
    markupXml.replace("</annots>", '<circle page="0" rect="1,1,2,2"/></annots>'),
    markupXml.replace('xmlns="http://ns.adobe.com/xfdf/"', 'xmlns="urn:wrong"'),
    markupXml.replace("page=\"1\"", "page=\"2\""),
    markupXml.replace("name=\"quad-mark\"", "name=\"same-name\""),
    markupXml.replace("coords=\"100,390,140,390,100,370,140,370,140,360,180,360,140,340,180,340\"", "coords=\"1,2,3,4,5,6,7\""),
    markupXml.replace("220,280</gesture>", "220,280;221</gesture>"),
    `<!DOCTYPE xfdf [<!ENTITY x SYSTEM "file:///etc/passwd">]><xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><text page="0" rect="40,40,64,64"><contents>&x;</contents></text></annots></xfdf>`,
  ];
  for (let index = 0; index < invalidFiles.length; index++) {
    await importXfdf(page, invalidFiles[index], `invalid-${index}.xfdf`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(1);
  }
  await importXfdf(page, validOne);
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(2);
  const ids = await page.locator(".imported-markup-layer [data-subtype]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-imported-markup-id")));
  expect(new Set(ids).size).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);

  const utf16Xml = '<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><text page="0" rect="40,40,64,64"><contents>日本語</contents></text></annots></xfdf>';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16Xml, "utf16le")]);
  await importBytes(page, utf16, "utf16.xfdf");
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(3);
  await expect(page.locator(".comment-card").filter({ hasText: "日本語" })).toBeVisible();
});

test("enforces file, annotation, and total point limits before committing and decodes UTF-16BE", async ({ page }) => {
  await openPdf(page, await sourcePdf());
  const undo = page.getByRole("button", { name: /^元に戻す/ });
  await expect(undo).toBeDisabled();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  const manyAnnotations = `<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots>${Array.from({ length: 5001 }, () => '<text page="0" rect="40,40,64,64"><contents>x</contents></text>').join("")}</annots></xfdf>`;
  const gesture = (count: number) => Array.from({ length: count }, (_, index) => `${index % 1000},${index % 900}`).join(";");
  const tooManyPoints = `<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><ink page="0" rect="40,40,64,64"><inklist><gesture>${gesture(50000)}</gesture><gesture>${gesture(50001)}</gesture></inklist></ink></annots></xfdf>`;
  const tooLarge = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);
  const invalid = [
    [tooLarge, "too-large.xfdf"],
    [Buffer.from(manyAnnotations), "too-many-annotations.xfdf"],
    [Buffer.from(tooManyPoints), "too-many-points.xfdf"],
  ] as const;
  for (const [bytes, filename] of invalid) {
    await importBytes(page, bytes, filename);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  }

  const xml = '<xfdf xmlns="http://ns.adobe.com/xfdf/"><annots><text page="0" rect="40,40,64,64" name="utf16be"><contents>日本語BE</contents></text></annots></xfdf>';
  const littleEndian = Buffer.from(xml, "utf16le");
  for (let i = 0; i < littleEndian.length; i += 2) [littleEndian[i], littleEndian[i + 1]] = [littleEndian[i + 1], littleEndian[i]];
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), littleEndian]);
  await importBytes(page, utf16be, "utf16be.xfdf");
  await expect(page.locator(".imported-markup-layer [data-subtype]")).toHaveCount(1);
  await expect(page.locator(".comment-card").filter({ hasText: "日本語BE" })).toBeVisible();
  await expect(undo).toBeEnabled();
});

test("imports CSV as independent page notes with undo and saved PDF round trips", async ({ page }, info) => {
  await openPdf(page, await sourcePdf());
  const cards = page.locator(".comment-card"); await expect(cards).toHaveCount(1);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "CSVを読み込む", exact: true }).click();
  await (await chooser).setFiles({ name: "comments.csv", mimeType: "text/csv", buffer: Buffer.from('\uFEFF"ページ","作成者","レビュー状態","コメント","区分"\r\n"1","山田","完了","CSVからのコメント","追加"\r\n"2","佐藤","未確認","次ページのメモ","既存"\r\n') });
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "CSVからのコメント" })).toContainText("山田");
  await page.getByRole("button", { name: /^元に戻す/ }).click(); await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: /^やり直す/ }).click(); await expect(cards).toHaveCount(3);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const path = info.outputPath("csv-notes.pdf"); await (await download).saveAs(path);
  await openPdf(page, await readFile(path)); await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "CSVからのコメント" })).toHaveCount(1);
});
