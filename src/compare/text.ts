export interface TextChange { kind: "same" | "removed" | "added"; text: string }
export interface TextDifference {
  changed: boolean;
  added: number;
  removed: number;
  simplified: boolean;
  changes: TextChange[];
}
export const MAX_PAGE_TEXT = 20000;
export const MAX_DOCUMENT_TEXT = 1000000;

/** Bound the LCS matrix; large edits still report exact changed text, in coarser groups. */
export function compareText(left: string, right: string): TextDifference {
  if (left.length > MAX_PAGE_TEXT || right.length > MAX_PAGE_TEXT)
    throw Error("文字比較は各ページ・各文書側で20,000文字までです。");
  const a = Array.from(left), b = Array.from(right);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const changes: TextChange[] = [];
  const append = (kind: TextChange["kind"], text: string) => {
    if (!text) return;
    const last = changes.at(-1);
    if (last?.kind === kind) last.text += text;
    else changes.push({ kind, text });
  };
  append("same", a.slice(0, start).join(""));
  const simplified = x.length * y.length > 1000000;
  if (simplified || !x.length || !y.length) {
    append("removed", x.join("")); append("added", y.join(""));
  } else {
    const columns = y.length + 1, matrix = new Uint16Array((x.length + 1) * columns);
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
      matrix[i * columns + j] = x[i] === y[j] ? matrix[(i + 1) * columns + j + 1] + 1
        : Math.max(matrix[(i + 1) * columns + j], matrix[i * columns + j + 1]);
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { append("same", x[i++]); j++; }
      else if (i < x.length && (j === y.length || matrix[(i + 1) * columns + j] >= matrix[i * columns + j + 1])) append("removed", x[i++]);
      else append("added", y[j++]);
    }
  }
  append("same", end ? a.slice(a.length - end).join("") : "");
  return { changed: left !== right, simplified,
    added: changes.filter(part => part.kind === "added").reduce((total, part) => total + Array.from(part.text).length, 0),
    removed: changes.filter(part => part.kind === "removed").reduce((total, part) => total + Array.from(part.text).length, 0), changes };
}

/** Keep PDF.js extraction order and spaces; discard only the final line terminator. */
export function extractedText(items: readonly ({ str: string; hasEOL?: boolean } | object)[]): string {
  let text = "";
  for (const item of items) {
    if (!("str" in item) || typeof item.str !== "string") continue;
    text += item.str + ("hasEOL" in item && item.hasEOL ? "\n" : "");
    if (text.length > MAX_PAGE_TEXT + 1) throw Error("文字比較は各ページ・各文書側で20,000文字までです。");
  }
  text = text.replace(/\n$/, "");
  if (text.length > MAX_PAGE_TEXT) throw Error("文字比較は各ページ・各文書側で20,000文字までです。");
  return text;
}
