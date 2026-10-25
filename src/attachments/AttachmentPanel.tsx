import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { uid } from "../state/model";
import { documentStore } from "../state/store";
import { loadAttachments, readAttachment, exportAttachmentZip } from "../export/client";
import { usePrompt } from "../components/Prompt";
import { attachmentItems, filterAttachments, batchAttachmentDeletion, MAX_BATCH_ATTACHMENTS, type AttachmentRow } from "./batch";
import { pickFiles, saveBytes } from "../platform/files";
import {
  addAttachments,
  attachmentName,
  editAttachment,
  MAX_ATTACHMENT_BYTES,
  type AttachmentInfo,
} from "./model";

export function AttachmentPanel({ model }: { model: DocumentModel }) {
  const prompt = usePrompt();
  const [query, setQuery] = useState(""), [showDeleted, setShowDeleted] = useState(false), [limit, setLimit] = useState(100);
  const [loadedSources, setLoadedSources] = useState<DocumentModel["sources"]>();
  const [imported, setImported] = useState<AttachmentInfo[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("添付ファイルを読み込み中"),
    [busy, setBusy] = useState(false);
  const task = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadAttachments({ sources: model.sources }, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setImported(items);
        setLoadedSources(model.sources);
        setStatus("");
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "添付一覧を取得できません。",
          );
          setStatus("");
        }
      });
    return () => controller.abort();
  }, [model.sources]);
  useEffect(() => () => task.current?.abort(), []);
  const ready = loadedSources === model.sources;
  let all: AttachmentRow[] = [], listError = "";
  try { all = attachmentItems(model, ready ? imported : []); }
  catch (reason) { listError = reason instanceof Error ? reason.message : "添付一覧が不正です。"; }
  const items = filterAttachments(all, query, showDeleted);
  const current = items.find((a) => a.id === selected);
  async function run(
    label: string,
    job: (signal: AbortSignal) => Promise<void>,
  ) {
    if (task.current) return;
    const c = new AbortController();
    task.current = c;
    setBusy(true);
    setError("");
    setStatus(label);
    try {
      await job(c.signal);
      if (!c.signal.aborted) setStatus("");
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error ? e.message : "添付ファイルの操作に失敗しました。",
        );
    } finally {
      task.current = null;
      setBusy(false);
      setStatus("");
    }
  }
  async function batch(deleted: boolean) {
    const snapshot = model, ids = items.map(a => a.id);
    await run(deleted ? "添付を一括削除中" : "添付を一括復元中", async signal => {
      const result = await prompt.ask({ title: deleted ? "添付を一括削除" : "添付を一括復元", confirm: deleted ? "削除" : "復元", danger: deleted,
        message: `絞り込み結果の${ids.length}件を${deleted ? "削除" : "復元"}します。元に戻す操作で取り消せます。` });
      if (!result || signal.aborted) return;
      documentStore.execute(batchAttachmentDeletion(snapshot, imported, ids, deleted));
      setSelected("");
    });
  }
  return (
    <div className="attachment-panel">
      <button
        disabled={busy}
        onClick={() =>
          void run("ファイルを追加中", async (signal) => {
            const files = await pickFiles("attachment", true);
            if (
              signal.aborted ||
              documentStore.document?.id !== model.id ||
              !files.length
            )
              return;
            if (files.some((f) => f.bytes.length > MAX_ATTACHMENT_BYTES))
              throw Error("添付ファイルは1件128MBまで対応しています。");
            const assets = files.map((f) => ({
              id: uid(),
              name: attachmentName(f.name),
              description: "",
              bytes: f.bytes,
            }));
            documentStore.execute(addAttachments(assets));
            setSelected(assets[0].id);
          })
        }
      >
        <Plus size={15} />
        添付ファイルを追加
      </button>
      <label>添付を検索<input aria-label="添付を検索" type="search" value={query} placeholder="名前・説明"
        onChange={event => { setQuery(event.target.value); setLimit(100); }} /></label>
      <label>添付の表示<select aria-label="添付の表示" value={showDeleted ? "deleted" : "active"}
        onChange={event => { setShowDeleted(event.target.value === "deleted"); setSelected(""); setLimit(100); }}>
        <option value="active">現在の添付</option><option value="deleted">削除した添付</option>
      </select></label>
      <div className="attachment-bulk">
        {!showDeleted && <button disabled={busy || !ready || !!listError || !items.length || items.length > MAX_BATCH_ATTACHMENTS}
          onClick={() => void run("添付ZIPを作成中", async signal => {
            const snapshot = model, bytes = await exportAttachmentZip(snapshot, items.map(a => a.id),
              value => setStatus(`添付ZIPを作成中 ${Math.round(value * 100)}%`), signal);
            if (signal.aborted || documentStore.document !== snapshot) {
              if (!signal.aborted) throw Error("文書が変更されました。添付を確認して取り出し直してください。");
              return;
            }
            await saveBytes(bytes, `${snapshot.name.replace(/\.(pdf|kpdf)$/i, "")}-添付.zip`);
          })}>絞り込んだ添付をZIPで取り出す</button>}
        <button className={showDeleted ? "" : "danger"} disabled={busy || !ready || !!listError || !items.length || items.length > MAX_BATCH_ATTACHMENTS}
          onClick={() => void batch(!showDeleted)}>{showDeleted ? "絞り込んだ添付を一括復元" : "絞り込んだ添付を一括削除"}</button>
        <p className="hint">{items.length}件が対象。一括操作は1000件まで。ZIPは1件128MB・合計256MBまでです。</p>
      </div>
      {listError && <p role="alert">{listError}</p>}
      <div className="attachment-list">
        {items.slice(0, limit).map((a) => (
          <button
            className={`attachment-item ${selected === a.id ? "active" : ""}`}
            key={a.id}
            onClick={() => setSelected(a.id)}
          >
            <strong>{a.name}</strong>
            <small>
              {a.size === undefined
                ? "サイズ不明"
                : `${(a.size / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} KB`}
            </small>
          </button>
        ))}
      </div>
      {items.length > limit && <button onClick={() => setLimit(value => value + 100)}>次の100件を表示</button>}
      {current && (
        <div className="attachment-editor">
          <label>
            添付ファイル名
            <input
              aria-label="添付ファイル名"
              value={current.name}
              onChange={(e) =>
                documentStore.execute(
                  editAttachment(current.id, { name: e.target.value }),
                )
              }
            />
          </label>
          <label>
            添付の説明
            <textarea
              aria-label="添付の説明"
              value={current.description}
              onChange={(e) =>
                documentStore.execute(
                  editAttachment(current.id, { description: e.target.value }),
                )
              }
            />
          </label>
          <button
            disabled={busy || current.deleted}
            onClick={() =>
              void run("添付を取り出し中", async (signal) => {
                const bytes = await readAttachment(model, current.id, signal);
                if (!signal.aborted)
                  await saveBytes(bytes, attachmentName(current.name));
              })
            }
          >
            <Download size={15} />
            添付を取り出す
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              documentStore.execute(
                editAttachment(current.id, { deleted: !current.deleted }),
              );
              setSelected("");
            }}
          >
            <Trash2 size={15} />
            {current.deleted ? "添付を復元" : "添付を削除"}
          </button>
        </div>
      )}
      {prompt.dialog}
      {status && <p role="status">{status}</p>}
      {busy && (
        <button onClick={() => task.current?.abort()}>キャンセル</button>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <p className="empty-panel">
        {items.length}{" "}
        件を表示（全{all.length}件）。削除した添付は元データが残る編集中・編集プロジェクト内で復元できます。変更はPDF保存時に反映されます。同名ファイルは保存時に番号を付けます。ページ抽出・分割・墨消し出力には添付を含めません。
      </p>
    </div>
  );
}
