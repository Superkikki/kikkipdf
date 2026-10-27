import { PDFArray, PDFDict, PDFName, type PDFDocument, type PDFFont } from "pdf-lib";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { verticalCMap } from "./vertical";

/** Record shaped glyphs, including alternates absent from the font's character map. */
export class HorizontalUnicode {
  private entries = new Map<PDFFont, { font: Font; glyphs: Map<number, string>; widths: Map<number, number> }>();

  register(font: PDFFont, bytes: Uint8Array) {
    this.entries.set(font, { font: fontkit.create(bytes) as Font, glyphs: new Map(), widths: new Map() });
  }

  record(font: PDFFont, text: string) {
    const entry = this.entries.get(font);
    if (!entry || !text) return;
    const glyphs = entry.font.layout(text).glyphs;
    for (const glyph of glyphs) {
      if (!Number.isInteger(glyph.id) || glyph.id < 0 || glyph.id > 65535 || !glyph.codePoints.length || glyph.codePoints.length > 1024 || glyph.codePoints.some(cp => !Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)))
        throw Error("文字のUnicode対応を確認できないためPDFに保存できません。");
    }
    const represented = glyphs.flatMap(glyph => glyph.codePoints).map(cp => String.fromCodePoint(cp)).join("");
    if (represented !== text) throw Error("フォントの字形変換で元の文字を保持できないためPDFに保存できません。別のフォントを選んでください。");
    for (const glyph of glyphs) {
      const value = String.fromCodePoint(...glyph.codePoints), previous = entry.glyphs.get(glyph.id);
      if (previous !== undefined && previous !== value)
        throw Error("同じ字形に異なる文字が割り当てられています。文字の検索・抽出を保つため保存を中止しました。");
      if (!Number.isFinite(glyph.advanceWidth) || !Number.isFinite(entry.font.unitsPerEm) || entry.font.unitsPerEm <= 0) throw Error("字形の幅を確認できないためPDFに保存できません。");
      entry.glyphs.set(glyph.id, value);
      entry.widths.set(glyph.id, glyph.advanceWidth * 1000 / entry.font.unitsPerEm);
    }
  }

  async apply(output: PDFDocument) {
    // The dictionaries exist only after font embedding. Replacing their Unicode maps
    // leaves the original glyphs and embedded outlines intact.
    for (const [font, entry] of this.entries) {
      if (!entry.glyphs.size) continue;
      await font.embed();
      const dict = output.context.lookup(font.ref, PDFDict);
      dict.set(PDFName.of("ToUnicode"), output.context.register(output.context.flateStream(verticalCMap(entry.glyphs))));
      const descendant = dict.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      const widths = [...entry.widths].sort((a, b) => a[0] - b[0]).flatMap(([id, width]) => [id, [width]]);
      descendant.set(PDFName.of("W"), output.context.obj(widths));
    }
  }
}
