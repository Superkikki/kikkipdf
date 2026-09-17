import { useEffect, useState } from "react";
import type { DocumentModel, LinkTarget } from "../state/model";
import { sourcePdf } from "../viewer/pdf";
import { documentStore } from "../state/store";
import { editAnnotation } from "../annotations/commands";
import { deleteObject, updateObject } from "../commands/document";
import { LinkTargetEditor } from "./LinkTargetEditor";
import { importedLinkUrl } from "./target";

interface ImportedLink {
  id: string;
  sourceId: string;
  page: number;
  url?: string;
  destination?: number;
}
export function LinkPanel({
  model,
  jump,
}: {
  model: DocumentModel;
  jump: (id: string) => void;
}) {
  const [imported, setImported] = useState<ImportedLink[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void (async () => {
      const result: ImportedLink[] = [];
      for (const source of Object.values(model.sources)) {
        const pdf = await sourcePdf(source);
        for (let i = 0; i < pdf.numPages; i++) {
          if (!live) return;
          const page = await pdf.getPage(i + 1);
          for (const a of await page.getAnnotations()) {
            if (a.subtype !== "Link") continue;
            const item: ImportedLink = {
              id: String(a.id),
              sourceId: source.id,
              page: i,
              url: importedLinkUrl(a.url ?? a.unsafeUrl),
            };
            try {
              const dest =
                typeof a.dest === "string"
                  ? await pdf.getDestination(a.dest)
                  : a.dest;
              if (Array.isArray(dest) && dest[0] !== undefined)
                item.destination =
                  typeof dest[0] === "number"
                    ? dest[0]
                    : await pdf.getPageIndex(dest[0]);
            } catch {
              /* Keep broken destinations visible for repair or deletion. */
            }
            result.push(item);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (live) setImported(result);
    })()
      .catch(() => {
        if (live) setError("既存リンクの一覧を読み込めませんでした。");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [model.sources]);
  const links = model.pages.flatMap((p, index) => [
    ...imported
      .filter(
        (a) =>
          a.sourceId === p.sourceId &&
          a.page === p.sourceIndex &&
          !p.annotationEdits?.[a.id]?.deleted,
      )
      .map((a) => {
        const targetPage = model.pages.find(
          (candidate) =>
            candidate.sourceId === a.sourceId &&
            candidate.sourceIndex === a.destination,
        );
        const target: LinkTarget | undefined =
          p.annotationEdits?.[a.id]?.link ??
          (a.url
            ? { kind: "url", url: a.url }
            : targetPage
              ? { kind: "page", pageId: targetPage.id }
              : undefined);
        return {
          id: a.id,
          key: `${p.id}:${a.id}`,
          pageId: p.id,
          index,
          target,
          added: false,
          editable: /^\d+R\d*$/.test(a.id),
        };
      }),
    ...p.objects
      .filter((o) => o.kind === "link")
      .map((o) => ({
        id: o.id,
        key: `${p.id}:${o.id}`,
        pageId: p.id,
        index,
        target: o.link,
        added: true,
        editable: true,
      })),
  ]);
  const current = links.find((l) => l.key === selected);
  function describe(target?: LinkTarget) {
    return target?.kind === "url"
      ? target.url
      : target?.kind === "page"
        ? `ページ ${model.pages.findIndex((p) => p.id === target.pageId) + 1}`
        : "移動先なし";
  }
  return (
    <div className="dialog-body link-panel">
      <p className="notice">
        「編集」→「リンク」でページ上に領域を追加できます。既存リンクの移動先変更は保存後に反映されます。外部URLはこのアプリから開きません。
      </p>
      {loading && <p role="status">リンクを読み込み中…</p>}
      {error && <p role="alert">{error}</p>}
      <label>
        文書内のリンク
        <select
          aria-label="文書内のリンク"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{links.length} 件のリンク</option>
          {links.map((l, i) => (
            <option key={l.key} value={l.key}>
              {i + 1}. ページ {l.index + 1} → {describe(l.target)}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <>
          {current.editable && (
            <LinkTargetEditor
              target={current.target}
              pages={model.pages}
              onChange={(link) =>
                documentStore.execute(
                  current.added
                    ? updateObject(current.pageId, current.id, { link })
                    : editAnnotation(current.pageId, current.id, { link }),
                )
              }
            />
          )}
          <button onClick={() => jump(current.pageId)}>配置ページを表示</button>
          {current.editable && (
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
              リンクを削除
            </button>
          )}
        </>
      )}
    </div>
  );
}
