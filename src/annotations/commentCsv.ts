import type { CommentRow } from "./comments";
import { reviewStatuses } from "./comments";

function cell(value: string): string {
  // Quoting alone does not prevent spreadsheet programs from executing formulas.
  const safe = /^[=+\-@]/.test(value.trimStart()) || /^[\t\r\n]/.test(value)
    ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** UTF-8 with BOM for spreadsheet compatibility; rows include the current edits. */
export function commentsCsv(rows: readonly CommentRow[]): Uint8Array {
  const records = [
    ["ページ", "作成者", "レビュー状態", "コメント", "区分"],
    ...rows.map(row => [
      String(row.pageIndex + 1), row.author,
      row.reviewable ? reviewStatuses[row.reviewStatus] : "対象外",
      row.text, row.importedMarkup ? "読み込み" : row.added ? "追加" : "既存",
    ]),
  ];
  return new TextEncoder().encode(`\uFEFF${records.map(row => row.map(cell).join(",")).join("\r\n")}\r\n`);
}
