import { useEffect, useState } from "react";
import type { AnnotationEdit, DocumentModel, ReviewStatus } from "../state/model";
import { documentStore } from "../state/store";
import { deleteObject, updateObject } from "../commands/document";
import { editAnnotation } from "./commands";
import { buildComments, filterComments, readComments, reviewStatuses, type ImportedComment } from "./comments";
import { commentsCsv } from "./commentCsv";
import { saveBytes } from "../platform/files";

export function CommentsPanel({ model, jump }: { model: DocumentModel; jump: (id: string) => void }) {
  const [loaded, setLoaded] = useState<{ sources: DocumentModel["sources"]; comments: ImportedComment[] }>();
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState("");
  const [pageId, setPageId] = useState("");
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
    setSelected(""); setQuery(""); setAuthor(""); setStatus(""); setPageId(""); setOffset(0); setSaveError("");
  }, [model.id]);
  const comments = buildComments(model, loaded?.sources === sources ? loaded.comments : []);
  const filtered = filterComments(comments, { query, author, status, pageId });
  const start = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / 100) * 100));
  const current = comments.find((comment) => comment.key === selected);
  const authors = [...new Set(comments.map((comment) => comment.author).filter(Boolean))].sort();
  function update(patch: AnnotationEdit) {
    if (!current) return;
    documentStore.execute(current.added ? updateObject(current.pageId, current.id, patch) : editAnnotation(current.pageId, current.id, patch));
  }
  function resetList() { setSelected(""); setOffset(0); }
  async function saveComments(filteredOnly: boolean) {
    setSaveError(""); setSaving(true);
    try {
      const rows = filteredOnly ? filtered : comments;
      await saveBytes(commentsCsv(rows), `${model.name.replace(/\.(pdf|kpdf)$/i, "")}-コメント${filteredOnly ? "-絞り込み" : ""}.csv`);
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
      <p role="status">{filtered.length} / {comments.length} 件</p>
      {(query || author || status || pageId) && <button onClick={() => {
        setQuery(""); setAuthor(""); setStatus(""); setPageId(""); resetList();
      }}>絞り込みを解除</button>}
    </div>
    <div className="comment-export">
      <button disabled={cannotExport || !comments.length} onClick={() => void saveComments(false)}>全件をCSV保存</button>
      <button disabled={cannotExport || !filtered.length} onClick={() => void saveComments(true)}>絞り込み結果をCSV保存</button>
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
        documentStore.execute(current.added ? deleteObject(current.pageId, current.id) : editAnnotation(current.pageId, current.id, { deleted: true }));
        setSelected("");
      }}>コメントを削除</button>
    </div>}
    {error && <p className="warning" role="alert">{error}</p>}
    {!filtered.length && loaded?.sources === sources && <p className="empty-panel">条件に一致するコメントがありません。</p>}
    <p className="empty-panel">コメントを選ぶと内容・作成者を編集できます。レビュー状態はメモ注釈に対応します。</p>
  </>;
}
