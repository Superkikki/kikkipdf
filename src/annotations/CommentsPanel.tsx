import { useEffect, useState } from "react";
import type { AnnotationEdit, DocumentModel, ReviewStatus } from "../state/model";
import { documentStore } from "../state/store";
import { deleteObject, updateObject } from "../commands/document";
import { editAnnotation } from "./commands";
import { buildComments, filterComments, readComments, commentTypes, reviewStatuses, type ImportedComment } from "./comments";
import { commentsCsv } from "./commentCsv";
import { commentsXfdf } from "./commentXfdf";
import { parseXfdf } from "./importXfdf";
import { addImportedMarkups, removeImportedMarkup, updateImportedMarkup } from "./importedMarkup";
import { flushInlineText } from "../editor/flushInlineText";
import { pickFiles, saveBytes } from "../platform/files";

export function CommentsPanel({ model, jump }: { model: DocumentModel; jump: (id: string) => void }) {
  const [loaded, setLoaded] = useState<{ sources: DocumentModel["sources"]; comments: ImportedComment[] }>();
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState("");
  const [pageId, setPageId] = useState("");
  const [subtype, setSubtype] = useState("");
  const [offset, setOffset] = useState(0);
  const sources = model.sources;
  useEffect(() => {
    let live = true;
    setError("");
    void Promise.all(Object.values(sources).map(readComments)).then((comments) => {
      if (live) setLoaded({ sources, comments: comments.flat() });
    }).catch(() => { if (live) setError("元のPDFのコメントを読み込めませんでした。"); });
    return () => { live = false; };
  }, [sources]);
  useEffect(() => {
    setSelected(""); setQuery(""); setAuthor(""); setStatus(""); setPageId(""); setSubtype(""); setOffset(0); setSaveError(""); setImportStatus("");
  }, [model.id]);
  const comments = buildComments(model, loaded?.sources === sources ? loaded.comments : []);
  const filtered = filterComments(comments, { query, author, status, pageId, subtype });
  const start = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / 100) * 100));
  const current = comments.find((comment) => comment.key === selected);
  const authors = [...new Set(comments.map((comment) => comment.author).filter(Boolean))].sort();
  function update(patch: AnnotationEdit) {
    if (!current) return;
    documentStore.execute(current.importedMarkup ? updateImportedMarkup(current.pageId, current.id, patch)
      : current.added ? updateObject(current.pageId, current.id, patch) : editAnnotation(current.pageId, current.id, patch));
  }
  function resetList() { setSelected(""); setOffset(0); }
  async function importComments() {
    if (!flushInlineText()) return;
    setSaveError(""); setImportStatus(""); setSaving(true);
    try {
      const [file] = await pickFiles("xfdf");
      if (!file) return;
      if (!flushInlineText()) return;
      const snapshot = documentStore.document;
      if (!snapshot || snapshot.id !== model.id) throw Error("文書が切り替わりました。読み込み先のPDFで再度実行してください。");
      const result = await parseXfdf(file.bytes, snapshot);
      if (documentStore.document !== snapshot) throw Error("読み込み中に文書が変更されました。再度実行してください。");
      documentStore.execute(addImportedMarkups(result.entries));
      resetList();
      setImportStatus(`${result.entries.length}件の注釈を読み込みました。Undoで戻せます。`);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "XFDFを読み込めませんでした。");
    } finally { setSaving(false); }
  }
  async function saveComments(filteredOnly: boolean, format: "csv" | "xfdf" = "csv") {
    if (!flushInlineText()) return;
    setSaveError(""); setSaving(true);
    try {
      const snapshot = documentStore.document;
      if (!snapshot || snapshot.id !== model.id || loaded?.sources !== snapshot.sources) return;
      const all = buildComments(snapshot, loaded.comments);
      const rows = filteredOnly ? filterComments(all, { query, author, status, pageId, subtype }) : all;
      const bytes = format === "xfdf" ? await commentsXfdf(snapshot, rows) : commentsCsv(rows);
      await saveBytes(bytes, `${snapshot.name.replace(/\.(pdf|kpdf)$/i, "")}-コメント${filteredOnly ? "-絞り込み" : ""}.${format}`);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "コメント一覧を保存できませんでした。");
    } finally { setSaving(false); }
  }
  const cannotExport = loaded?.sources !== sources || !!error || saving;
  return <>
    <div className="comment-filters">
      <label>検索<input aria-label="コメントを検索" type="search" value={query}
        onChange={(event) => { setQuery(event.target.value); resetList(); }} placeholder="内容・作成者" /></label>
      <label>作成者<select aria-label="コメントの作成者で絞り込み" value={author}
        onChange={(event) => { setAuthor(event.target.value); resetList(); }}>
        <option value="">すべての作成者</option>
        {authors.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>状態<select aria-label="コメントの状態で絞り込み" value={status}
        onChange={(event) => { setStatus(event.target.value); resetList(); }}>
        <option value="">すべての状態</option>
        {Object.entries(reviewStatuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>ページ<select aria-label="コメントのページで絞り込み" value={pageId}
        onChange={(event) => { setPageId(event.target.value); resetList(); }}>
        <option value="">すべてのページ</option>
        {model.pages.map((page, index) => <option key={page.id} value={page.id}>ページ {index + 1}</option>)}
      </select></label>
      <label>種類<select aria-label="コメントの種類で絞り込み" value={subtype}
        onChange={(event) => { setSubtype(event.target.value); resetList(); }}>
        <option value="">すべての種類</option>
        <option value="xfdf">XFDF対応の種類</option>
        {[...new Set(comments.map(comment => comment.subtype).filter((value): value is string => !!value))].sort().map(value =>
          <option key={value} value={value}>{commentTypes[value] ?? value}</option>)}
      </select></label>
      <p role="status">{filtered.length} / {comments.length} 件</p>
      {(query || author || status || pageId || subtype) && <button onClick={() => {
        setQuery(""); setAuthor(""); setStatus(""); setPageId(""); setSubtype(""); resetList();
      }}>絞り込みを解除</button>}
    </div>
    <div className="comment-export">
      <button disabled={saving} onClick={() => void importComments()}>XFDFを読み込む</button>
    </div>
    {importStatus && <p role="status">{importStatus}</p>}
    <div className="comment-export">
      <button disabled={cannotExport || !comments.length} onClick={() => void saveComments(false)}>全件をCSV保存</button>
      <button disabled={cannotExport || !filtered.length} onClick={() => void saveComments(true)}>絞り込み結果をCSV保存</button>
    </div>
    <div className="comment-export">
      <button disabled={cannotExport || !comments.length} onClick={() => void saveComments(false, "xfdf")}>全件をXFDF保存</button>
      <button disabled={cannotExport || !filtered.length} onClick={() => void saveComments(true, "xfdf")}>絞り込み結果をXFDF保存</button>
    </div>
    {saveError && <p className="warning" role="alert">{saveError}</p>}
    {loaded?.sources !== sources && !error && <p className="empty-panel" role="status">コメントを読み込み中…</p>}
    {filtered.slice(start, start + 100).map((comment) => <button
      className={`comment-card ${selected === comment.key ? "active" : ""}`} key={comment.key}
      onClick={() => { setSelected(comment.key); jump(comment.pageId); }}>
      <small>ページ {comment.pageIndex + 1} · {comment.author || "作成者なし"}</small>
      {comment.reviewable && <small className="comment-state">{reviewStatuses[comment.reviewStatus]}</small>}
      <p>{comment.text || "（内容なし）"}</p>
    </button>)}
    {filtered.length > 100 && <div className="comment-pagination">
      <button disabled={start === 0} onClick={() => setOffset(start - 100)}>前の100件</button>
      <span>{start + 1}–{Math.min(start + 100, filtered.length)}</span>
      <button disabled={start + 100 >= filtered.length} onClick={() => setOffset(start + 100)}>次の100件</button>
    </div>}
    {current && current.editable && <div className="comment-editor">
      <p>選択中: ページ {current.pageIndex + 1}</p>
      <label>コメント内容<textarea aria-label="コメント内容" value={current.text}
        onChange={(event) => update({ text: event.target.value })} /></label>
      <label>作成者<input aria-label="コメントの作成者" value={current.author} maxLength={10000}
        onChange={(event) => update({ author: event.target.value })} /></label>
      {current.reviewable && <label>レビュー状態<select aria-label="コメントのレビュー状態" value={current.reviewStatus}
        onChange={(event) => update({ reviewStatus: event.target.value as ReviewStatus })}>
        {Object.entries(reviewStatuses).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>}
      <button className="danger" onClick={() => {
        documentStore.execute(current.importedMarkup ? removeImportedMarkup(current.pageId, current.id)
          : current.added ? deleteObject(current.pageId, current.id) : editAnnotation(current.pageId, current.id, { deleted: true }));
        setSelected("");
      }}>コメントを削除</button>
    </div>}
    {error && <p className="warning" role="alert">{error}</p>}
    {!filtered.length && loaded?.sources === sources && <p className="empty-panel">条件に一致するコメントがありません。</p>}
    <p className="empty-panel">コメントを選ぶと内容・作成者を編集できます。レビュー状態はメモ注釈に対応します。</p>
  </>;
}
