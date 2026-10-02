import type { StandardFonts, PDFDocument, PDFFont } from "pdf-lib";
import type { FontAsset } from "../state/model";
import type { TextStyle } from "./layout";

export function fontKey(
  o: Pick<TextStyle, "font" | "fontId" | "bold" | "italic">,
) {
  return o.font === "custom"
    ? `custom-${o.fontId}`
    : o.font === "japanese"
      ? "japanese"
      : `${o.font}-${o.bold}-${o.italic}`;
}
export function standardFont(
  o: Pick<TextStyle, "font" | "bold" | "italic">,
): StandardFonts {
  const family =
    o.font === "serif" ? "Times" : o.font === "mono" ? "Courier" : "Helvetica";
  return (
    family === "Times"
      ? o.bold
        ? o.italic
          ? "Times-BoldItalic"
          : "Times-Bold"
        : o.italic
          ? "Times-Italic"
          : "Times-Roman"
      : family +
        (o.bold
          ? o.italic
            ? "-BoldOblique"
            : "-Bold"
          : o.italic
            ? "-Oblique"
            : "")
  ) as StandardFonts;
}
export async function embedTextFont(
  output: PDFDocument,
  o: TextStyle,
  fontBytes?: Uint8Array,
  custom?: FontAsset,
) {
  if (o.font === "custom") {
    if (!custom || custom.id !== o.fontId)
      throw Error("登録フォントが見つかりません。");
    return output.embedFont(custom.bytes, { subset: false });
  }
  if (o.font !== "japanese") return output.embedFont(standardFont(o));
  if (!fontBytes)
    throw Error(
      "日本語フォントが見つかりません。npm run assets を実行してください。",
    );
  // fontkit's CFF/variable-font subsetter can preserve Unicode extraction while
  // emitting broken glyph outlines. Keep the verified static font intact.
  return output.embedFont(fontBytes, { subset: false });
}
export function previewFontFamily(font: TextStyle["font"], fontId?: string) {
  return font === "custom"
    ? customFontFamily(fontId)
    : font === "japanese"
      ? "Noto Sans JP, sans-serif"
      : font === "serif"
        ? "Times New Roman, serif"
        : font === "mono"
          ? "Courier New, monospace"
          : "Arial, sans-serif";
}
export function customFontFamily(id?: string) {
  if (!id || !/^font-[a-f0-9]{64}$/.test(id))
    throw Error("登録フォントIDが不正です。");
  return `Kikki${id.slice(5)}`;
}
export function assertGlyphs(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  const missing = [
    ...new Set(Array.from(text.replace(/[\r\n\t]/g, ""))),
  ].filter((s) => !supported.has(s.codePointAt(0)!));
  if (missing.length)
    throw Error(
      `登録フォントに含まれない文字があります: ${missing.slice(0, 8).join(" ")}。別のフォントを選んでください。`,
    );
}
