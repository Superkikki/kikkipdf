import fontkit, { type Font } from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, beginText, endText,
  setFontAndSize, setTextMatrix, showText, setFillingColor, rgb, pushGraphicsState, popGraphicsState,
  translate, rotateRadians, setGraphicsState, type PDFPage, type PDFRef } from "pdf-lib";
import type { TextLayout, TextStyle } from "./layout";
import type { EditObject } from "../state/model";
const parsed = new WeakMap<Uint8Array, Font>();
export function verticalFont(bytes: Uint8Array) {
  let font = parsed.get(bytes);
  if (!font) { font = fontkit.create(bytes) as Font; parsed.set(bytes, font); }
  return font;
}
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
export interface VerticalGlyph { id: number; path: string; width: number; }
export interface VerticalCell { text: string; id: number; column: number; row: number; }
/** Upright cells with vert/vrt2 substitutions. No characters are dropped to fit. */
export function layoutVertical(style: TextStyle, bytes: Uint8Array): TextLayout {
  if (!["japanese", "custom"].includes(style.font)) throw Error("縦書きには日本語または登録フォントを選んでください。");
  const font = verticalFont(bytes), glyphs = new Map<number, VerticalGlyph>();
  const cells: VerticalCell[] = [], columns: string[] = [];
  const maxRows = style.wrap ? Math.max(1, Math.floor((style.height ?? style.fontSize) / style.fontSize)) : Infinity;
  let column = 0, row = 0, count = 0;
  const next = () => { columns[column] ??= ""; column++; row = 0; };
  const text = (style.text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  for (const { segment } of segmenter.segment(text)) {
    if (++count > 10000) throw Error("縦書きテキストは1オブジェクト10000文字まで対応しています。");
    if (segment === "\n") { next(); continue; }
    if (row >= maxRows) next();
    const shaped = font.layout(segment, ["vert", "vrt2"]);
    if (shaped.glyphs.length !== 1 || !shaped.glyphs[0].id)
      throw Error(`この縦書き文字の字形は対応していません: ${segment}`);
    const glyph = shaped.glyphs[0];
    if (!Number.isFinite(glyph.advanceWidth) || glyph.advanceWidth <= 0) throw Error("縦書きの文字幅が不正です。");
    if (!glyphs.has(glyph.id)) glyphs.set(glyph.id, { id: glyph.id, path: glyph.path.toSVG(), width: glyph.advanceWidth * 1000 / font.unitsPerEm });
    cells.push({ text: segment, id: glyph.id, column, row });
    columns[column] = (columns[column] ?? "") + segment; row++;
  }
  columns[column] ??= "";
  const counts = new Map<number, number>();
  for (const cell of cells) counts.set(cell.column, cell.row + 1);
  const height = Math.max(1, ...counts.values()) * style.fontSize + style.fontSize * 0.25;
  return { lines: columns.map((text, i) => ({ text, width: style.fontSize, baseline: i * style.fontSize * (style.lineHeight ?? 1.25) })),
    height, width: style.fontSize + column * style.fontSize * (style.lineHeight ?? 1.25),
    vertical: { cells, glyphs: [...glyphs.values()], unitsPerEm: font.unitsPerEm } };
}
const unicodeHex = (text: string) => Array.from(text).map(c => {
  const n = c.codePointAt(0)!;
  return n <= 0xffff ? n.toString(16).padStart(4, "0") :
    ((n - 0x10000 >> 10) + 0xd800).toString(16) + ((n - 0x10000 & 1023) + 0xdc00).toString(16);
}).join("");
export function verticalCMap(entries: Map<number, string>) {
  const pairs = [...entries].map(([id, text]) => `<${id.toString(16).padStart(4, "0")}> <${unicodeHex(text)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const group = pairs.slice(i, i + 100); blocks.push(`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /KikkiVerticalUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${blocks.join("\n")}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
}
/** A separate Identity-V font dictionary shares only the immutable embedded font file.
 * Explicit W2 origins/advances and ToUnicode include all substituted glyphs. */
export function createVerticalWriter(output: PDFDocument) {
  const fonts = new Map<string, { ref: PDFRef; dict: PDFDict; descendant: PDFDict; unicode: Map<number, string>; widths: Map<number, number>; cmapRef?: PDFRef }>();
  return async (page: PDFPage, object: EditObject, bytes: Uint8Array, cropX: number, cropTop: number) => {
    const layout = layoutVertical(object, bytes), vertical = layout.vertical!;
    const cacheKey = object.font === "custom" ? object.fontId! : "japanese";
    let entry = fonts.get(cacheKey);
    if (!entry) {
      const baseFont = await output.embedFont(bytes, { subset: false }); await baseFont.embed();
      const dict = output.context.lookup(baseFont.ref, PDFDict).clone();
      const original = dict.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      const descendant = original.clone();
      dict.delete(PDFName.of("ToUnicode"));
      dict.set(PDFName.of("Encoding"), PDFName.of("Identity-V"));
      dict.set(PDFName.of("DescendantFonts"), output.context.obj([output.context.register(descendant)]));
      entry = { ref: output.context.register(dict), dict, descendant, unicode: new Map(), widths: new Map() }; fonts.set(cacheKey, entry);
    }
    for (const glyph of vertical.glyphs) entry.widths.set(glyph.id, glyph.width);
    for (const cell of vertical.cells) {
      const previous = entry.unicode.get(cell.id);
      if (previous !== undefined && previous !== cell.text) throw Error("同じ縦書き字形への異なるUnicode対応は保存できません。");
      entry.unicode.set(cell.id, cell.text);
    }
    entry.descendant.set(PDFName.of("DW"), PDFNumber.of(1000));
    entry.descendant.set(PDFName.of("DW2"), output.context.obj([880, -1000]));
    entry.descendant.set(PDFName.of("W"), output.context.obj([...entry.widths].flatMap(([id, width]) => [id, [width]])));
    entry.descendant.set(PDFName.of("W2"), output.context.obj([...entry.widths].flatMap(([id, width]) => [id, [-1000, width / 2, 880]])));
    // Reuse the same reference when more columns add Unicode entries; no stale CMaps survive.
    const cmap = output.context.flateStream(verticalCMap(entry.unicode));
    if (entry.cmapRef) output.context.assign(entry.cmapRef, cmap);
    else entry.cmapRef = output.context.register(cmap);
    entry.dict.set(PDFName.of("ToUnicode"), entry.cmapRef);
    const name = page.node.newFontDictionary("KikkiVertical", entry.ref);
    const color = object.color.match(/\w\w/g)!.map(hex => parseInt(hex, 16) / 255);
    page.pushOperators(pushGraphicsState(), translate(cropX + object.x, cropTop - object.y - object.height),
      rotateRadians(-object.rotation * Math.PI / 180), translate(-cropX - object.x, -cropTop + object.y + object.height));
    if (object.bold || object.italic) throw Error("縦書きでは太字・斜体の登録フォントを選んでください。");
    const alpha = page.node.newExtGState("KikkiAlpha", output.context.obj({ Type: "ExtGState", ca: object.opacity, CA: object.opacity }));
    page.pushOperators(setGraphicsState(alpha));
    const columns = new Map<number, VerticalCell[]>();
    for (const cell of vertical.cells) {
      const cells = columns.get(cell.column) ?? []; cells.push(cell); columns.set(cell.column, cells);
    }
    for (const [column, cells] of columns) {
      if (!cells.length) continue;
      const encoded = cells.map(cell => cell.id.toString(16).padStart(4, "0")).join("");
      const x = cropX + object.x + object.width - object.fontSize / 2 - column * object.fontSize * (object.lineHeight ?? 1.25);
      page.pushOperators(beginText(), setFillingColor(rgb(color[0], color[1], color[2])), setFontAndSize(name, object.fontSize),
        setTextMatrix(1, 0, 0, 1, x, cropTop - object.y), showText(PDFHexString.of(encoded)), endText());
    }
    page.pushOperators(popGraphicsState()); return layout;
  };
}
