import { change } from "../commands/document";
import type { DocumentModel, PageModel } from "../state/model";

export type PageLabelStyle = "D" | "R" | "r" | "A" | "a" | "";
export interface PageLabelOptions {
  style: PageLabelStyle;
  prefix: string;
  start: number;
}
export const MAX_PAGE_LABEL_LENGTH = 512;

export function validPageLabel(value: string) {
  if (value.length > MAX_PAGE_LABEL_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

/** A label belongs to its page, so reordering or extracting preserves it. */
export function pageLabel(page: Pick<PageModel, "label">, index: number): string {
  return page.label ?? String(index + 1);
}

function roman(number: number) {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let value = "";
  for (let i = 0; i < values.length; i++) {
    while (number >= values[i]) { value += symbols[i]; number -= values[i]; }
  }
  return value;
}

export function generatePageLabels(count: number, options: PageLabelOptions): string[] {
  const { style, prefix, start } = options;
  if (!Number.isInteger(count) || count < 0 || count > 10000)
    throw Error("ラベルを設定するページ数が不正です。");
  if (!["D", "R", "r", "A", "a", ""].includes(style))
    throw Error("ページラベルの番号形式が不正です。");
  if (typeof prefix !== "string" || prefix.length > 128 || !validPageLabel(prefix))
    throw Error("接頭辞は制御文字を含まない128文字以内で入力してください。");
  if (!Number.isInteger(start) || start < 1 || start > 1_000_000)
    throw Error("開始番号は1〜1000000の整数で入力してください。");
  if (style === "" && !prefix.trim())
    throw Error("番号なしの場合は接頭辞を入力してください。");
  const last = start + Math.max(0, count - 1);
  if (style && last > 1_000_000)
    throw Error("ページラベルの番号は1000000までです。");
  if ((style === "R" || style === "r") && last > 3999)
    throw Error("ローマ数字の番号は1〜3999の範囲で指定してください。");
  if ((style === "A" || style === "a") && prefix.length + Math.ceil(last / 26) > MAX_PAGE_LABEL_LENGTH)
    throw Error("ページラベルは512文字以内にしてください。");
  return Array.from({ length: count }, (_, i) => {
    const number = start + i;
    let suffix = "";
    if (style === "D") suffix = String(number);
    else if (style === "R" || style === "r") {
      suffix = roman(number);
      if (style === "r") suffix = suffix.toLowerCase();
    } else if (style === "A" || style === "a") {
      // PDF letter labels repeat the same letter: A..Z, AA, BB..ZZ, AAA.
      suffix = String.fromCharCode(style.charCodeAt(0) + (number - 1) % 26)
        .repeat(Math.ceil(number / 26));
    }
    return prefix + suffix;
  });
}

function selectedIndices(indices: number[], model: DocumentModel) {
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= model.pages.length))
    throw Error("ラベルを設定するページ範囲が不正です。");
  return [...new Set(indices)].sort((a, b) => a - b);
}

export function setPageLabels(indices: number[], options: PageLabelOptions) {
  return change("ページラベルを設定", (model) => {
    const selected = selectedIndices(indices, model);
    const labels = generatePageLabels(selected.length, options);
    const updates = new Map(selected.map((index, i) => [index, labels[i]]));
    let changed = false;
    const pages = model.pages.map((page, index) => {
      const label = updates.get(index);
      if (label === undefined || label === page.label) return page;
      changed = true;
      return { ...page, label };
    });
    return changed ? { ...model, pages } : model;
  });
}

export function clearPageLabels(indices: number[]) {
  return change("ページラベルを解除", (model) => {
    const selected = new Set(selectedIndices(indices, model));
    let changed = false;
    const pages = model.pages.map((page, index) => {
      if (!selected.has(index) || page.label === undefined) return page;
      changed = true;
      const next = { ...page };
      delete next.label;
      return next;
    });
    return changed ? { ...model, pages } : model;
  });
}

export function findPageByLabel(pages: PageModel[], value: string, current: number) {
  if (pages[current] && pageLabel(pages[current], current) === value) return current;
  return pages.findIndex((page, index) => pageLabel(page, index) === value);
}
