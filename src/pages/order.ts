import { change } from "../commands/document";
import type { DocumentModel } from "../state/model";
export type PageOrderPreset = "reverse" | "oddEven" | "evenOdd" | "interleave";
export const MAX_ORDER_PAGES = 10000;
function checkCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ORDER_PAGES) throw Error("ページ順序の編集は1〜10000ページまでです。");
}
/** One-based input supports descending ranges; each physical page must occur once. */
export function parsePageOrder(input: string, count: number): number[] {
  checkCount(count);
  if (input.length > 100000 || !input.trim()) throw Error("ページ順序は 3-1,4-6 の形式で全ページを指定してください。");
  const result: number[] = [], seen = new Set<number>();
  for (const part of input.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw Error("ページ順序は 3-1,4-6 の形式で入力してください。");
    const start = Number(match[1]), end = Number(match[2] ?? start);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || start > count || end < 1 || end > count)
      throw Error(`ページは1〜${count}の範囲で指定してください。`);
    const step = start <= end ? 1 : -1;
    for (let value = start; ; value += step) {
      if (seen.has(value)) throw Error(`ページ${value}が重複しています。各ページを一度ずつ指定してください。`);
      seen.add(value); result.push(value - 1);
      if (value === end) break;
    }
  }
  if (result.length !== count) throw Error(`未指定のページが${count - result.length}件あります。全ページを一度ずつ指定してください。`);
  return result;
}
export function pageOrderPreset(count: number, mode: PageOrderPreset, frontCount = Math.ceil(count / 2), reverseBack = true): number[] {
  checkCount(count);
  const indices = Array.from({ length: count }, (_, i) => i);
  if (mode === "reverse") return indices.reverse();
  const odd = indices.filter(i => i % 2 === 0), even = indices.filter(i => i % 2 === 1);
  if (mode === "oddEven") return [...odd, ...even];
  if (mode === "evenOdd") return [...even, ...odd];
  if (mode !== "interleave" || !Number.isInteger(frontCount) || frontCount < 1 || frontCount >= count)
    throw Error("交互に並べる前半のページ数は1以上・全体より少ない整数で指定してください。");
  const front = indices.slice(0, frontCount), back = indices.slice(frontCount);
  if (reverseBack) back.reverse();
  const result: number[] = [];
  for (let i = 0; i < Math.max(front.length, back.length); i++) {
    if (i < front.length) result.push(front[i]);
    if (i < back.length) result.push(back[i]);
  }
  return result;
}
export function reorderAllPages(snapshot: DocumentModel, indices: number[]) {
  checkCount(snapshot.pages.length);
  if (indices.length !== snapshot.pages.length || new Set(indices).size !== indices.length ||
      indices.some(i => !Number.isInteger(i) || i < 0 || i >= snapshot.pages.length) ||
      new Set(snapshot.pages.map(page => page.id)).size !== snapshot.pages.length)
    throw Error("全ページを重複なく一度ずつ指定してください。");
  const order = [...indices];
  return change("ページ順序を変更", document => {
    if (document !== snapshot) throw Error("文書が変更されました。ページ順序の画面を開き直してください。");
    const pages = order.map(i => document.pages[i]);
    return pages.every((page, i) => page === document.pages[i]) ? document : { ...document, pages };
  });
}
