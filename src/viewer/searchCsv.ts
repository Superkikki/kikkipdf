import type { SearchHit, SearchOptions } from "./search";

/** Export every retained hit, with enough context to identify a limited search. */
export function searchCsv(hits: readonly SearchHit[], query: string, options: SearchOptions,
  pageRange: string, limited: boolean): Uint8Array {
  const cell = (value: string) => {
    const safe = /^[=+\-@]/.test(value.trimStart()) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const yes = (value: boolean) => value ? "はい" : "いいえ";
  const rows = [["ページ", "前の文脈", "一致文字", "後の文脈", "検索語", "ページ範囲", "大文字小文字を区別", "単語全体", "全角半角を同一視", "上限による省略あり"],
    ...hits.map(hit => [String(hit.pageNumber), hit.before, hit.match, hit.after, query,
      pageRange.trim() || "全ページ", yes(options.caseSensitive), yes(options.wholeWord), yes(options.normalizeWidth), yes(limited)])];
  return new TextEncoder().encode(`\uFEFF${rows.map(row => row.map(cell).join(",")).join("\r\n")}\r\n`);
}
