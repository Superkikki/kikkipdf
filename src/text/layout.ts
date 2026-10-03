import type { VerticalCell, VerticalGlyph } from "./vertical";
import type { EditObject } from "../state/model";

export type TextStyle = Pick<
  EditObject,
  | "text"
  | "width"
  | "fontSize"
  | "font"
  | "fontId"
  | "bold"
  | "italic"
  | "wrap"
  | "lineHeight"
> & { height?: number; writingMode?: "vertical" };
export interface TextLine {
  text: string;
  width: number;
  baseline: number;
}
export interface TextLayout {
  vertical?: { cells: VerticalCell[]; glyphs: VerticalGlyph[]; unitsPerEm: number };
  lines: TextLine[];
  height: number;
  width: number;
}
const opening = /[（［｛「『【〈《〔([{]$/u;
const closing =
  /^[、。，．？！：；）］｝」』】〉》〕)\]},.!?:;ぁぃぅぇぉっゃゅょァィゥェォッャュョー]/u;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/** Shared by preview and PDF export. Never discards characters to fit a box.
 * Prefer word/CJK boundaries; overlong words fall back to grapheme boundaries.
 * Basic Japanese punctuation rules are best effort when the box is too narrow.
 */
export function layoutText(
  style: TextStyle,
  measure: (text: string) => number,
): TextLayout {
  const width = Math.max(1, style.width);
  const spacing = style.fontSize * (style.lineHeight ?? 1.25);
  const lines: TextLine[] = [];
  const add = (text: string) =>
    lines.push({
      text,
      width: measure(text),
      baseline: style.fontSize + lines.length * spacing,
    });
  const paragraphs = (style.text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n");
  for (const paragraph of paragraphs) {
    if (!style.wrap || !paragraph) {
      add(paragraph);
      continue;
    }
    const glyphs = Array.from(
      segmenter.segment(paragraph),
      (part) => part.segment,
    );
    for (let start = 0; start < glyphs.length; ) {
      const fits = (end: number) =>
        measure(glyphs.slice(start, end).join("")) <= width + 0.001;
      let low = start + 1,
        high = low;
      // Exponential search avoids measuring the entire remaining paragraph per line.
      while (high < glyphs.length && fits(high)) {
        low = high;
        high = Math.min(glyphs.length, start + (high - start) * 2);
      }
      if (fits(high)) low = high;
      else {
        while (low + 1 < high) {
          const mid = Math.floor((low + high) / 2);
          if (fits(mid)) low = mid;
          else high = mid;
        }
      }
      let end = low;
      if (end < glyphs.length) {
        let preferred = 0,
          allowed = 0;
        for (let i = start + 1; i <= end; i++) {
          const left = glyphs[i - 1],
            right = glyphs[i];
          if (opening.test(left) || closing.test(right)) continue;
          allowed = i;
          if (/\s|-$/u.test(left) || cjk.test(left) || cjk.test(right))
            preferred = i;
        }
        end = preferred || allowed || end;
      }
      add(glyphs.slice(start, end).join(""));
      start = end;
    }
  }
  return {
    lines,
    // Include a descender allowance below the last baseline. Height is advisory;
    // all lines are exported, including those outside the current object box.
    height: style.fontSize * 0.25 + (lines.at(-1)?.baseline ?? 0),
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
  };
}
