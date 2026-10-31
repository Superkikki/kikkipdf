import { textPosition } from "./textPosition";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../../src/direct/content";
import { parsePackedCMap } from "../../src/direct/predefinedCMaps";

for (const kind of ["shift-jis", "identity-without-tounicode", "embedded-encoding"] as const) {
  test(`directly edits ${kind} Japanese text, removes source glyphs and preserves neighbours after saving`, async ({ page }, info) => {
    const pdf = await PDFDocument.create(), sheet = pdf.addPage([420, 595]), neighbourFont = await pdf.embedFont(StandardFonts.Helvetica);
    let hex = "93fa967b8cea";
    let encoding = PDFName.of("90ms-RKSJ-H");
    if (kind === "identity-without-tounicode") {
      const cmap = parsePackedCMap(new Uint8Array(await readFile("node_modules/pdfjs-dist/cmaps/90ms-RKSJ-H.bcmap"))).map;
      hex = [0x93fa, 0x967b, 0x8cea].map(code => (cmap.values.get(code) as number).toString(16).padStart(4, "0")).join("");
      encoding = PDFName.of("Identity-H");
    }
    const descendant = pdf.context.register(pdf.context.obj({ Type: "Font", Subtype: "CIDFontType0", BaseFont: "HeiseiMin-W3",
      CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Japan1"), Supplement: 0 }, DW: 1000 }));
    const font = pdf.context.register(pdf.context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "HeiseiMin-W3",
      Encoding: kind === "embedded-encoding" ? pdf.context.register(pdf.context.flateStream(
        "1 begincodespacerange <01000000> <010000ff> endcodespacerange 1 begincidrange <01000001> <01000003> 100 endcidrange")) : encoding,
      DescendantFonts: [descendant], ...(kind === "embedded-encoding" ? { ToUnicode: pdf.context.register(pdf.context.flateStream(
        "1 begincodespacerange <01000000> <010000ff> endcodespacerange 3 beginbfchar <01000001> <65e5> <01000002> <672c> <01000003> <8a9e> endbfchar")) } : {}) }));
    if (kind === "embedded-encoding") hex = "010000010100000201000003";
    sheet.node.set(PDFName.of("Resources"), pdf.context.obj({ Font: { F1: font, F2: neighbourFont.ref } }));
    sheet.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
      `BT /F1 20 Tf 1 0 0 1 40 520 Tm <${hex}> Tj /F2 20 Tf ( Neighbour) Tj ET`)));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
    await (await chooser).setFiles({ name: "japanese-font.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
    const original = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^日本語$/ });
    const neighbour = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /Neighbour/ });
    await expect(original).toBeVisible();
    const before = await textPosition(neighbour);
    await original.dblclick();
    const input = page.getByRole("textbox", { name: "ページ上のテキスト編集", exact: true });
    await expect(input).toBeFocused(); await expect(input).toHaveValue("日本語");
    await input.fill("変更した文字"); await input.press("Enter");
    await expect(original).toHaveCount(0);
    await expect(page.locator(".viewer-scroll .editable-text")).toContainText("変更した文字");
    const after = await textPosition(neighbour);
    expect(after!.x).toBeCloseTo(before!.x, 1); expect(after!.y).toBeCloseTo(before!.y, 1);
    const download = page.waitForEvent("download"); await page.keyboard.press("Control+s");
    const output = info.outputPath("edited-japanese.pdf"); await (await download).saveAs(output);
    const inspection = await inspectDirectText(new Uint8Array(await readFile(output)), 0);
    expect(inspection.runs.some(r => r.text === "変更した文字")).toBe(true);
    expect(inspection.runs.some(r => r.text === "日本語")).toBe(false);
    expect(errors).toEqual([]);
  });
}
