import { uid, type DocumentModel, type ImportedMarkup, type ReviewStatus } from "../state/model";
import { reviewStatuses } from "./comments";

/** CSV carries no annotation geometry: import each record as an independent note. */
export function parseCommentsCsv(bytes: Uint8Array, model: DocumentModel) {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw Error("コメントCSVは空でない8MB以下のファイルを選んでください。");
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw Error("CSVの文字コードを読み込めません。UTF-8またはBOM付きUTF-16を使用してください。"); }
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ""; closed = false; if (row.length > 5) throw Error("コメントCSVは5列の形式にしてください。"); };
  const pushRow = () => { pushField(); rows.push(row); row = []; if (rows.length > 5001) throw Error("CSVのコメント数は5000件までです。"); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ",") pushField();
    else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; pushRow(); }
    else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw Error("CSVの引用符の形式が不正です。");
      field += c;
    }
  }
  if (quoted) throw Error("CSVの引用符が閉じられていません。");
  if (field || row.length || closed) pushRow();
  const header = ["ページ", "作成者", "レビュー状態", "コメント", "区分"];
  if (JSON.stringify(rows.shift()) !== JSON.stringify(header)) throw Error("このアプリで保存したコメントCSVの5列の見出しを使用してください。");
  if (!rows.length) throw Error("CSVにコメントがありません。");
  const statuses = new Map(Object.entries(reviewStatuses).map(([key, label]) => [label, key as ReviewStatus]));
  const positions = new Map<string, number>();
  return rows.map((record, index) => {
    if (record.length !== 5) throw Error(`CSVの${index + 2}行目は5列にしてください。`);
    const [pageNumber, author, state, contents, category] = record;
    const page = /^\d+$/.test(pageNumber) ? model.pages[Number(pageNumber) - 1] : undefined;
    if (!page) throw Error(`CSVの${index + 2}行目のページ番号が現在のPDFの範囲外です。`);
    if (author.length > 10000 || contents.length > 1_000_000) throw Error("CSVの作成者またはコメントが長すぎます。");
    const reviewStatus = state === "対象外" ? "None" : statuses.get(state);
    if (!reviewStatus || !["既存", "追加", "読み込み"].includes(category)) throw Error(`CSVの${index + 2}行目のレビュー状態・区分が不正です。`);
    const offset = positions.get(page.id) ?? 0; positions.set(page.id, offset + 1);
    const markup: ImportedMarkup = { id: uid(), subtype: "Text", text: contents, author, reviewStatus,
      x: Math.min(24, Math.max(0, page.width - 24)),
      y: Math.min(24 + (offset % Math.max(1, Math.floor((page.height - 48) / 28))) * 28, Math.max(0, page.height - 24)),
      width: 24, height: 24, color: "#f5b83d", opacity: 1, strokeWidth: 1, icon: "Comment", flags: 4 };
    return { pageId: page.id, markup };
  });
}
