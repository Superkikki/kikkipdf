import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { uid } from "../state/model";
import { documentStore } from "../state/store";
import { loadAttachments, readAttachment } from "../export/client";
import { pickFiles, saveBytes } from "../platform/files";
import {
  addAttachments,
  attachmentName,
  editAttachment,
  MAX_ATTACHMENT_BYTES,
  type AttachmentInfo,
} from "./model";

export function AttachmentPanel({ model }: { model: DocumentModel }) {
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
        setImported(items);
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
  const items = [
    ...imported.filter(
      (a) =>
        a.documentLevel ||
        model.pages.some(
          (p) => p.sourceId === a.sourceId && a.pages.includes(p.sourceIndex),
        ),
    ),
    ...(model.attachments ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      size: a.bytes.length,
    })),
  ]
    .filter((a) => !model.attachmentEdits?.[a.id]?.deleted)
    .map((a) => ({ ...a, ...model.attachmentEdits?.[a.id] }));
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
      <div className="attachment-list">
        {items.map((a) => (
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
            disabled={busy}
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
                editAttachment(current.id, { deleted: true }),
              );
              setSelected("");
            }}
          >
            <Trash2 size={15} />
            添付を削除
          </button>
        </div>
      )}
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
        件の添付。変更はPDF保存時に反映されます。同名ファイルは保存時に番号を付けます。ページ抽出・分割・墨消し出力には添付を含めません。
      </p>
    </div>
  );
}
