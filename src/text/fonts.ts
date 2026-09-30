import type { StandardFonts, PDFDocument } from "pdf-lib";
import type { TextStyle } from "./layout";

export function fontKey(o: Pick<TextStyle, "font" | "bold" | "italic">) {
  return o.font === "japanese" ? "japanese" : `${o.font}-${o.bold}-${o.italic}`;
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
) {
  if (o.font !== "japanese") return output.embedFont(standardFont(o));
  if (!fontBytes)
    throw Error(
      "日本語フォントが見つかりません。npm run assets を実行してください。",
    );
  // fontkit's CFF/variable-font subsetter can preserve Unicode extraction while
  // emitting broken glyph outlines. Keep the verified static font intact.
  return output.embedFont(fontBytes, { subset: false });
}
export function previewFontFamily(font: TextStyle["font"]) {
  return font === "japanese"
    ? "Noto Sans JP, sans-serif"
    : font === "serif"
      ? "Times New Roman, serif"
      : font === "mono"
        ? "Courier New, monospace"
        : "Arial, sans-serif";
}
