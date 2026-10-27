import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import { HorizontalUnicode } from "../src/text/horizontalUnicode";
import fontkit from "@pdf-lib/fontkit";

it("maps contextual Japanese-font glyphs used in the PDF to their original Unicode", async () => {
  const bytes = new Uint8Array(await readFile("public/assets/NotoSansJP-Regular.otf"));
  const input = "CASE-098 日本語 office", model = emptyDocument(); model.pages = [blankPage()];
  model.pages[0].objects = [{ ...newObject("text", 20, 20), text: input, width: 400, wrap: false }];
  const output = await PDFDocument.load(await exportPdf(model, bytes));
  const resources = output.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
  const dict = resources.lookup(resources.keys()[0], PDFDict), stream = output.context.lookup(dict.get(PDFName.of("ToUnicode")));
  if (!(stream instanceof PDFRawStream)) throw Error("missing ToUnicode stream");
  const cmap = new TextDecoder().decode(decodePDFRawStream(stream).getBytes(1_000_000)), shaped = fontkit.create(bytes).layout(input).glyphs;
  for (const glyph of shaped) {
    const id = glyph.id.toString(16).padStart(4, "0"), unicode = glyph.codePoints.map(cp => cp.toString(16).padStart(4, "0")).join("");
    expect(cmap.toLowerCase()).toContain(`<${id}> <${unicode}>`);
  }
  expect(cmap).toContain("beginbfchar");
  const widths = dict.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict).lookup(PDFName.of("W"), PDFArray);
  const actual = new Map<number, number>(); for (let i = 0; i < widths.size(); i += 2) actual.set(widths.lookup(i, PDFNumber).asNumber(), widths.lookup(i + 1, PDFArray).lookup(0, PDFNumber).asNumber());
  const font = fontkit.create(bytes); for (const glyph of shaped) expect(actual.get(glyph.id)).toBeCloseTo(glyph.advanceWidth * 1000 / font.unitsPerEm);
});
it("rejects ambiguous mappings instead of saving misleading searchable text", () => {
  const mappings = new HorizontalUnicode();
  const fakeFont = {} as import("pdf-lib").PDFFont;
  const fakeParsed = { unitsPerEm: 1000, layout(text: string) { return { glyphs: [{ id: 42, advanceWidth: 500, codePoints: [text.codePointAt(0)!] }] }; } };
  (mappings as unknown as { entries: Map<unknown, unknown> }).entries.set(fakeFont, { font: fakeParsed, glyphs: new Map(), widths: new Map() });
  mappings.record(fakeFont, "A"); expect(() => mappings.record(fakeFont, "B")).toThrow("異なる文字");
});

it("rejects a Unicode ligature if shaping loses the original character", async () => {
  const bytes = new Uint8Array(await readFile("public/assets/NotoSansJP-Regular.otf"));
  const model = emptyDocument(); model.pages = [blankPage()];
  model.pages[0].objects = [{ ...newObject("text", 20, 20), text: "ffi\nﬃ", wrap: false }];
  await expect(exportPdf(model, bytes)).rejects.toThrow("元の文字を保持できない");
});
