import { useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import { usePrompt } from "../components/Prompt";
import { pickFiles, saveBytes } from "../platform/files";
import { bookmarkDeletionPlan, bookmarksJson, deleteMatchingBookmarks, importBookmarks, readBookmarkFile } from "./bookmarkTransfer";

export function BookmarkFileActions({ model, query }: { model: DocumentModel; query: string }) {
  const prompt = usePrompt(), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  let plan: ReturnType<typeof bookmarkDeletionPlan> | undefined, limitError = "";
  try { plan = bookmarkDeletionPlan(model, query); }
  catch (reason) { limitError = reason instanceof Error ? reason.message : "しおりが多すぎます。"; }
  async function run(job: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setStatus("");
    try { await job(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "しおりの操作に失敗しました。"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <details className="bookmark-file-actions">
    <summary>しおりの入出力・一括削除</summary>
    <button disabled={busy || !!limitError || !model.bookmarks?.length} onClick={() => void run(async () => {
      const bytes = bookmarksJson(model);
      const result = await saveBytes(bytes, `${model.name.replace(/\.(pdf|kpdf)$/i, "")}-しおり.json`);
      if (result) setStatus("すべてのしおりをJSONへ書き出しました。");
    })}>しおりJSONを書き出す</button>
    <button disabled={busy || !!limitError} onClick={() => void run(async () => {
      const snapshot = model, [file] = await pickFiles("json");
      if (!file) return;
      const data = readBookmarkFile(file.bytes);
      // Validate the destination document before showing a confirmation for its contents.
      if (documentStore.document !== snapshot) throw Error("文書が変更されました。しおりJSONを選び直してください。");
      const count = (nodes: typeof data.bookmarks): number => nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);
      const total = count(data.bookmarks);
      if (!total) { setStatus("読み込みファイルにしおりがありません。"); return; }
      const result = await prompt.ask({ title: "しおりJSONを追加", confirm: "追加",
        message: `${total}件を既存のしおりの後ろへ追加します。元文書は${data.pageCount}ページです。ページ番号に補正値を足し、現在の文書のページへ移します。位置・倍率は同じPDF座標で保持します。`,
        fields: [{ key: "offset", label: "ページ番号の補正", type: "number", value: "0" }] });
      if (!result) return;
      if (!/^-?\d+$/.test(result.offset)) throw Error("ページ番号の補正は整数で指定してください。");
      documentStore.execute(importBookmarks(snapshot, data, Number(result.offset)));
      setStatus(`${total}件のしおりを追加しました。元に戻す操作で取り消せます。`);
    })}>しおりJSONを読み込む</button>
    <p className="hint">書き出しは検索条件にかかわらず全件が対象です。読み込みでは階層・表示位置・URL・文字装飾を保持します。</p>
    <button className="danger" disabled={busy || !plan?.removed} onClick={() => void run(async () => {
      const snapshot = model, target = bookmarkDeletionPlan(snapshot, query);
      const result = await prompt.ask({ title: "しおりを一括削除", confirm: "削除", danger: true,
        message: `${query.trim() ? `「${query}」に名前が一致する` : "すべての"}しおり${target.matched}件と、その子を含む合計${target.removed}件を削除します。元に戻す操作で取り消せます。` });
      if (!result) return;
      documentStore.execute(deleteMatchingBookmarks(snapshot, query));
      setStatus(`${target.removed}件のしおりを削除しました。`);
    })}>絞り込んだしおりを一括削除</button>
    {plan && <p className="hint">名前の一致: {plan.matched}件 ／ 子を含む削除対象: {plan.removed}件</p>}
    {(error || limitError) && <p role="alert">{error || limitError}</p>}
    {status && <p role="status">{status}</p>}
    {prompt.dialog}
  </details>;
}
