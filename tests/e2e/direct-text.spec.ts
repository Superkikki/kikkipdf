import { test, expect, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../../src/direct/content";
import { openProject } from "../../src/state/project";
async function fixture(cropped = false, merged = false) {
  const pdf = await PDFDocument.create(),
    p = pdf.addPage([420, 595]);
  p.drawRectangle({
    x: 0,
    y: 0,
    width: 420,
    height: 595,
    color: rgb(0.2, 0.6, 0.8),
  });
  p.drawRectangle({
    x: 80,
    y: 480,
    width: 100,
    height: 100,
    color: rgb(0.8, 0.7, 0.2),
  });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const neighbourFont = await pdf.embedFont(StandardFonts.TimesRoman);
  // Independent Tj commands inside one text object exercise downstream placement.
  const streams = p.node.Contents();
  const raw = pdf.context.flateStream(
    `BT /F1 20 Tf 1 0 0 1 40 520 Tm (Editable original) Tj /${merged ? "F1" : "F2"} 20 Tf ( Neighbour) Tj ET`,
  );
  p.node.set(
    PDFName.of("Resources"),
    pdf.context.obj({ Font: { F1: font.ref, F2: neighbourFont.ref } }),
  );
  p.node.set(
    PDFName.of("Contents"),
    pdf.context.obj([
      ...(streams instanceof PDFArray ? streams.asArray() : [streams!]),
      pdf.context.register(raw),
    ]),
  );
  if (cropped) p.setCropBox(20, 30, 380, 550);
  return Buffer.from(await pdf.save());
}
async function open(page: Page, buffer: Buffer, name = "direct.pdf") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: name.endsWith(".pdf") ? "application/pdf" : "application/zip",
    buffer,
  });
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]").first(),
  ).toBeVisible();
}
const original = (page: Page) =>
  page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /^Editable original$/ });
test("direct edit removes source glyphs without covering backgrounds, preserving neighbours, search, undo and saved PDF", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await open(page, await fixture());
  const neighbour = page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /Neighbour/ });
  const before = await neighbour.boundingBox();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.locator(".properties")).toContainText(
    "既存テキストを直接編集",
  );
  await expect(original(page)).toHaveCount(0);
  // Leave the inline input before exercising document Undo, rather than typing Undo.
  await page.locator(".page-caption").click();
  await page.keyboard.press("Control+z");
  await expect(original(page)).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(original(page)).toHaveCount(0);
  await page.getByLabel("テキスト内容").fill("Changed direct text");
  const overlay = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(overlay).toHaveText("Changed direct text");
  const after = await neighbour.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1);
  expect(after!.y).toBeCloseTo(before!.y, 1);
  await expect(
    page.locator(".viewer-scroll .page-view[data-rendered=true]"),
  ).toBeVisible();
  const background = await page
    .locator(".viewer-scroll canvas")
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d")!;
      return [45, 95].map((x) =>
        Array.from(
          ctx.getImageData(
            Math.round((x * canvas.width) / 420),
            Math.round((65 * canvas.height) / 595),
            1,
            1,
          ).data,
        ).slice(0, 3),
      );
    });
  expect(background).toEqual([
    [51, 153, 204],
    [204, 178, 51],
  ]);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByLabel("PDF内を検索").fill("Editable original");
  await expect(page.locator(".search-count")).toContainText("0 / 0 件");
  await page.getByLabel("PDF内を検索").fill("Changed direct text");
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("direct.kpdf");
  await (await download).saveAs(project);
  const reopened = await openProject(new Uint8Array(await readFile(project)));
  expect(reopened.pages[0].objects[0].kind).toBe("direct-text");
  expect(reopened.pages[0].objects[0].sourceText!.originalText).toBe(
    "Editable original",
  );
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("direct.pdf");
  await (await download).saveAs(saved);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Changed direct text",
  );
  await expect(original(page)).toHaveCount(0);
  await expect(neighbour).toBeVisible();
  await page.reload();
  await open(page, await readFile(project), "direct.kpdf");
  await expect(original(page)).toHaveCount(0);
  await expect(overlay).toHaveText("Changed direct text");
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  await page
    .getByRole("button", { name: "元の文字に戻す", exact: true })
    .click();
  await expect(original(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("direct edit and delete work on a rotated page with original CropBox", async ({
  page,
}, info) => {
  await page.goto("/");
  await open(page, await fixture(true));
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.getByLabel("テキスト内容")).toHaveValue(
    "Editable original",
  );
  await page.getByLabel("テキスト内容").fill("Rotated edit");
  await page
    .locator(".properties")
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(original(page)).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("deleted.pdf");
  await (await download).saveAs(saved);
  expect(
    (await PDFDocument.load(await readFile(saved))).getPage(0).getRotation()
      .angle,
  ).toBe(90);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(original(page)).toHaveCount(0);
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Neighbour",
  );
});
test("unsupported transparency-group Form XObject text is explicitly refused and appearance replacement remains opt-in", async ({
  page,
}) => {
  const inner = await PDFDocument.create();
  inner
    .addPage([420, 595])
    .drawText("Editable original", { x: 40, y: 520, size: 20 });
  const doc = await PDFDocument.create();
  doc.addPage([420, 595]).drawPage(await doc.embedPage(inner.getPage(0)));
  await doc.flush();
  for (const [, object] of doc.context.enumerateIndirectObjects())
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"))
      object.dict.set(PDFName.of("Group"), doc.context.obj({ S: "Transparency" }));
  await page.goto("/");
  await open(page, Buffer.from(await doc.save()));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await expect(page.getByRole("alert")).toContainText("Form XObject");
  await expect(page.locator(".viewer-scroll .editable-text")).toHaveCount(0);
  await expect(original(page)).toBeVisible();
  await page.getByRole("button", { name: "見た目の置換", exact: true }).click();
  await original(page).dblclick();
  await expect(page.locator(".properties")).toContainText(
    "元の文字情報は残ります",
  );
  await page.getByLabel("テキスト内容").fill("Appearance replacement");
  await expect(original(page)).toHaveCount(1);
});
test("edits a PDF.js span assembled from multiple adjacent text drawing operations", async ({
  page,
}, info) => {
  await page.goto("/");
  await open(page, await fixture(false, true));
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await page
    .locator(".viewer-scroll .textLayer span")
    .filter({ hasText: /^Editable original Neighbour$/ })
    .dblclick();
  await expect(page.getByLabel("テキスト内容")).toHaveValue(
    "Editable original Neighbour",
  );
  await page.getByLabel("テキスト内容").fill("Merged replacement");
  await expect(page.locator(".viewer-scroll .textLayer span")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("merged.pdf");
  await (await download).saveAs(saved);
  await page.reload();
  await open(page, await readFile(saved));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText(
    "Merged replacement",
  );
  await expect(page.locator(".viewer-scroll .textLayer")).not.toContainText(
    "Editable original",
  );
});

test("directly edits verified Differences text, keeps neighbouring glyphs and saves without the source text", async ({ page }, info) => {
  const pdf = await PDFDocument.create();
  const p = pdf.addPage([420, 595]);
  const originalFont = await pdf.embedFont(StandardFonts.Helvetica);
  const neighbourFont = await pdf.embedFont(StandardFonts.TimesRoman);
  await pdf.flush();
  const font = pdf.context.lookup(originalFont.ref);
  if (!(font instanceof PDFDict)) throw Error("Font dictionary missing");
  font.set(PDFName.of("Encoding"), pdf.context.obj({ BaseEncoding: "WinAnsiEncoding", Differences: [128, "eacute", "Agrave"] }));
  font.set(PDFName.of("FirstChar"), pdf.context.obj(128));
  font.set(PDFName.of("LastChar"), pdf.context.obj(129));
  font.set(PDFName.of("Widths"), pdf.context.obj([
    originalFont.widthOfTextAtSize("é", 1000), originalFont.widthOfTextAtSize("À", 1000),
  ]));
  font.set(PDFName.of("ToUnicode"), pdf.context.register(pdf.context.flateStream(
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <80> <00E9> <81> <00C0> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end",
  )));
  p.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: originalFont.ref, F2: neighbourFont.ref } }));
  p.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
    "BT /F1 20 Tf 1 0 0 1 40 520 Tm <8081> Tj /F2 20 Tf ( Neighbour) Tj ET",
  )));
  await page.goto("/");
  await open(page, Buffer.from(await pdf.save()), "custom-encoding.pdf");
  const target = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^éÀ$/ });
  const neighbour = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /Neighbour/ });
  await expect(target).toBeVisible();
  const before = (await neighbour.boundingBox())!;
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await target.dblclick();
  await expect(page.locator(".properties")).toContainText("既存テキストを直接編集");
  await page.getByLabel("テキスト内容").fill("Edited accent text");
  await expect(target).toHaveCount(0);
  const after = (await neighbour.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("edited-custom-encoding.pdf");
  await (await download).saveAs(output);
  const inspected = await inspectDirectText(new Uint8Array(await readFile(output)), 0);
  expect(inspected.runs.some(r => r.text === "éÀ")).toBe(false);
  expect(inspected.runs.some(r => r.text === "Edited accent text")).toBe(true);
  await page.reload();
  await open(page, await readFile(output));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText("Edited accent text");
  await expect(page.locator(".viewer-scroll .textLayer")).not.toContainText("éÀ");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Edited accent text$/ }).dblclick();
  await expect(page.locator(".properties")).toContainText("既存テキストを直接編集");
  await page.getByLabel("テキスト内容").fill("Edited again");
  const secondDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const secondOutput = info.outputPath("edited-again.pdf");
  await (await secondDownload).saveAs(secondOutput);
  const second = await inspectDirectText(new Uint8Array(await readFile(secondOutput)), 0);
  expect(second.runs.some(r => r.text === "Edited accent text" || r.text === "éÀ")).toBe(false);
  expect(second.runs.some(r => r.text === "Edited again")).toBe(true);
});

test("edits only the selected shared Form invocation, preserving backgrounds, neighbours, undo and saved PDF", async ({ page }, info) => {
  const inner = await PDFDocument.create(), ip = inner.addPage([420, 595]);
  ip.drawRectangle({ x: 0, y: 0, width: 420, height: 595, color: rgb(0.2, 0.6, 0.8) });
  ip.drawText("Editable original", { x: 40, y: 520, size: 20 });
  ip.drawText("Neighbour", { x: 210, y: 520, size: 20, font: await inner.embedFont(StandardFonts.TimesRoman) });
  const middle = await PDFDocument.create();
  middle.addPage([420, 595]).drawPage(await middle.embedPage((await PDFDocument.load(await inner.save())).getPage(0)));
  const pdf = await PDFDocument.create(), p = pdf.addPage([420, 595]);
  const embedded = await pdf.embedPage((await PDFDocument.load(await middle.save())).getPage(0));
  p.drawPage(embedded);
  p.drawPage(embedded, { y: -180 });
  await page.goto("/");
  await open(page, Buffer.from(await pdf.save()), "nested-shared-form.pdf");
  await expect(original(page)).toHaveCount(2);
  const neighbours = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Neighbour$/ });
  const before = await neighbours.first().boundingBox();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).first().dblclick();
  await expect(page.locator(".properties")).toContainText("既存テキストを直接編集");
  await page.getByLabel("テキスト内容").fill("Form changed");
  await expect(original(page)).toHaveCount(1);
  const after = await neighbours.first().boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1); expect(after!.y).toBeCloseTo(before!.y, 1);
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
  const background = await page.locator(".viewer-scroll canvas").first().evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(
      Math.round(45 * canvas.width / 420), Math.round(65 * canvas.height / 595), 1, 1).data).slice(0, 3));
  expect(background).toEqual([51, 153, 204]);
  // Undo the text change and then the direct-edit object creation.
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(original(page)).toHaveCount(2);
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await page.getByRole("button", { name: /^やり直す/ }).click();
  await expect(original(page)).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("edited-nested-form.pdf");
  await (await download).saveAs(output);
  const inspection = await inspectDirectText(new Uint8Array(await readFile(output)), 0);
  expect(inspection.runs.filter(r => r.text === "Editable original")).toHaveLength(1);
  expect(inspection.runs.some(r => r.text === "Form changed")).toBe(true);
  await page.reload(); await open(page, await readFile(output));
  await expect(original(page)).toHaveCount(1);
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText("Form changed");
  const sourceForm = (await PDFDocument.load(await readFile(output))).context.enumerateIndirectObjects()
    .map(([, value]) => value).find(value => value instanceof PDFRawStream && value.dict.get(PDFName.of("Subtype")) === PDFName.of("Form"));
  expect(sourceForm).toBeDefined();
  // The unedited invocation remains independently editable after saving and reopening.
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存文字", exact: true }).click();
  await original(page).dblclick();
  await page.getByLabel("テキスト内容").fill("Other form changed");
  await expect(original(page)).toHaveCount(0);
  const secondDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const secondOutput = info.outputPath("all-forms-edited.pdf");
  await (await secondDownload).saveAs(secondOutput);
  const secondInspection = await inspectDirectText(new Uint8Array(await readFile(secondOutput)), 0);
  expect(secondInspection.runs.some(r => r.text === "Editable original")).toBe(false);
  expect(secondInspection.runs.filter(r => ["Form changed", "Other form changed"].includes(r.text))).toHaveLength(2);
});

for (const sample of [
  { name: "Japanese glyph name", base: StandardFonts.Helvetica, code: "80", encoding: { Differences: [128, "uni65E5"] }, text: "日", width: 1000 },
  { name: "accented custom encoding", base: StandardFonts.Helvetica, code: "80", encoding: { BaseEncoding: "WinAnsiEncoding", Differences: [128, "Aacute"] }, text: "Á" },
  { name: "StandardEncoding ligature", base: StandardFonts.Helvetica, code: "AE", encoding: "StandardEncoding", text: "ﬁ" },
  { name: "Symbol glyph", base: StandardFonts.Symbol, code: "41", encoding: undefined, text: "Α" },
  { name: "Dingbats glyph", base: StandardFonts.ZapfDingbats, code: "21", encoding: undefined, text: "✁", extractedText: "!" },
]) {
  test(`one click edits ${sample.name} without ToUnicode and preserves its neighbour on save`, async ({ page }) => {
    const pdf = await PDFDocument.create();
    const sheet = pdf.addPage([420, 595]);
    const font = await pdf.embedFont(sample.base);
    const neighbourFont = await pdf.embedFont(StandardFonts.TimesRoman);
    await pdf.flush();
    const dict = pdf.context.lookup(font.ref, PDFDict);
    if (sample.encoding) dict.set(PDFName.of("Encoding"), pdf.context.obj(sample.encoding));
    else dict.delete(PDFName.of("Encoding"));
    if ("width" in sample) {
      dict.set(PDFName.of("FirstChar"), pdf.context.obj(128));
      dict.set(PDFName.of("LastChar"), pdf.context.obj(128));
      dict.set(PDFName.of("Widths"), pdf.context.obj([sample.width]));
    }
    sheet.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font.ref, F2: neighbourFont.ref } }));
    sheet.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
      `BT /F1 20 Tf 1 0 0 1 40 520 Tm <${sample.code}> Tj /F2 20 Tf ( Neighbour) Tj ET`,
    )));
    const bytes = await pdf.save();
    const before = await inspectDirectText(bytes, 0);
    expect(before.runs.map(r => r.text)).toEqual([sample.text, " Neighbour"]);
    await page.goto("/");
    await open(page, Buffer.from(bytes));
    const span = page.locator(".viewer-scroll .textLayer span").filter({ hasText: ("extractedText" in sample ? sample.extractedText! : sample.text).normalize("NFKC") }).first();
    await expect(span).toBeVisible();
    await span.click();
    const input = page.getByRole("textbox", { name: "ページ上のテキスト編集", exact: true });
    await expect(input).toBeFocused();
    if ("extractedText" in sample) await expect(input).toHaveValue(sample.text);
    await input.fill("Changed");
    await input.press("Enter");
    const download = page.waitForEvent("download");
    await page.keyboard.press("Control+s");
    const output = await readFile((await (await download).path())!);
    const after = await inspectDirectText(output, 0);
    expect(after.runs.some(r => r.text === "Changed")).toBe(true);
    expect(after.runs.some(r => r.text.includes(sample.text))).toBe(false);
    expect(after.runs.find(r => r.text === " Neighbour")!.x).toBeCloseTo(before.runs[1].x, 7);
  });
}
