import { useEffect, useState } from "react";
import type { DocumentModel } from "../state/model";
import { sourcePdf } from "../viewer/pdf";
import { documentStore } from "../state/store";
import { deleteObject, updateObject } from "../commands/document";
import { editAnnotation } from "./commands";
interface Comment {
  id: string;
  sourceId: string;
  sourceIndex: number;
  text: string;
}
export function CommentsPanel({
  model,
  jump,
}: {
  model: DocumentModel;
  jump: (id: string) => void;
}) {
  const [imported, setImported] = useState<Comment[]>([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const sources = model.sources;
  useEffect(() => {
    let live = true;
    setError("");
    void (async () => {
      const result: Comment[] = [];
      for (const source of Object.values(sources)) {
        const pdf = await sourcePdf(source);
        for (let i = 0; i < pdf.numPages; i++) {
          if (!live) return;
          const p = await pdf.getPage(i + 1);
          for (const a of await p.getAnnotations()) {
            const text = a.contentsObj?.str as string | undefined;
            if (text)
              result.push({
                id: String(a.id),
                sourceId: source.id,
                sourceIndex: i,
                text,
              });
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (live) setImported(result);
    })().catch(() => {
      if (live) setError("元のPDFのコメントを読み込めませんでした。");
    });
    return () => {
      live = false;
    };
  }, [sources]);
  const comments = model.pages.flatMap((page) => [
    ...imported
      .filter(
        (c) =>
          c.sourceId === page.sourceId &&
          c.sourceIndex === page.sourceIndex &&
          !page.annotationEdits?.[c.id]?.deleted,
      )
      .map((c) => ({
        ...c,
        key: `${page.id}:${c.id}`,
        pageId: page.id,
        text: page.annotationEdits?.[c.id]?.text ?? c.text,
        added: false,
        editable: /^\d+R\d*$/.test(c.id),
      })),
    ...page.objects
      .filter((o) => o.kind === "note")
      .map((o) => ({
        id: o.id,
        key: o.id,
        pageId: page.id,
        text: o.text ?? "",
        added: true,
        editable: true,
      })),
  ]);
  const current = comments.find((c) => c.key === selected);
  function update(value: string) {
    if (!current) return;
    documentStore.execute(
      current.added
        ? updateObject(current.pageId, current.id, { text: value })
        : editAnnotation(current.pageId, current.id, { text: value }),
    );
  }
  return (
    <>
      {comments.map((c) => (
        <button
          className={`comment-card ${selected === c.key ? "active" : ""}`}
          key={c.key}
          onClick={() => {
            setSelected(c.key);
            jump(c.pageId);
          }}
        >
          <small>
            ページ {model.pages.findIndex((p) => p.id === c.pageId) + 1}
          </small>
          <p>{c.text}</p>
        </button>
      ))}
      {current && current.editable && (
        <div className="comment-editor">
          <label>
            コメント内容
            <textarea
              aria-label="コメント内容"
              value={current.text}
              onChange={(e) => update(e.target.value)}
            />
          </label>
          <button
            className="danger"
            onClick={() => {
              documentStore.execute(
                current.added
                  ? deleteObject(current.pageId, current.id)
                  : editAnnotation(current.pageId, current.id, {
                      deleted: true,
                    }),
              );
              setSelected("");
            }}
          >
            コメントを削除
          </button>
        </div>
      )}
      {error && <p className="warning">{error}</p>}
      <p className="empty-panel">
        コメントを選ぶと内容を編集・削除できます。元のコメントの変更は保存後にページの外観へ反映されます。
      </p>
    </>
  );
}
