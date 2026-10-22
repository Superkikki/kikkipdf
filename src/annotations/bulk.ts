import type { Command } from "../commands/history";
import type { DocumentModel, EditObject, ImportedMarkup, ReviewStatus } from "../state/model";
import type { CommentRow } from "./comments";
import { reviewStatuses } from "./comments";
import { importedMarkupSchema } from "./importedMarkup";

export type CommentBatchAction = { kind: "review"; status: ReviewStatus } | { kind: "author"; author: string } | { kind: "delete" };
const kinds = new Set(["note", "highlight", "underline", "strike", "ink"]);

/** Capture the complete filtered result, including rows outside the visible 100 cards. */
export function batchComments(snapshot: DocumentModel, rows: readonly CommentRow[], action: CommentBatchAction): Command {
  if (rows.length > 5000) throw Error("コメントの一括操作は5000件までです。条件を絞り込んでください。");
  if (action.kind === "review" && !Object.hasOwn(reviewStatuses, action.status)) throw Error("レビュー状態が不正です。");
  if (action.kind === "author" && (typeof action.author !== "string" || action.author.length > 10000)) throw Error("作成者は10000文字以下にしてください。");
  const targets = rows.map(row => ({ ...row })), captured = { ...action };
  const keys = new Set<string>();
  for (const row of targets) {
    const key = `${row.pageId}:${row.importedMarkup ? "markup" : row.added ? "object" : "source"}:${row.id}`;
    if (!row.editable || row.importedMarkup && row.added || keys.has(key) || captured.kind === "review" && !row.reviewable)
      throw Error("一括操作の対象に編集できないコメントが含まれています。");
    keys.add(key);
  }
  return { label: captured.kind === "delete" ? "コメントを一括削除" : captured.kind === "author" ? "コメントの作成者を一括変更" : "コメントを一括レビュー",
    apply(document) {
      if (document !== snapshot) throw Error("文書が変更されました。対象を確認して再度実行してください。");
      const pages = new Map(document.pages.map(page => [page.id, page]));
      const objectIndexes = new Map<string, Map<string, EditObject>>();
      const markupIndexes = new Map<string, Map<string, ImportedMarkup>>();
      for (const row of targets) {
        const page = pages.get(row.pageId);
        if (!page) throw Error("対象のコメントが見つかりません。");
        if (row.importedMarkup) {
          let index = markupIndexes.get(page.id);
          if (!index) { index = new Map(page.importedMarkups?.map(item => [item.id, item])); markupIndexes.set(page.id, index); }
          const markup = index.get(row.id);
          if (!markup || captured.kind === "review" && markup.subtype !== "Text") throw Error("対象の注釈が変更されています。");
        } else if (row.added) {
          let index = objectIndexes.get(page.id);
          if (!index) { index = new Map(page.objects.map(item => [item.id, item])); objectIndexes.set(page.id, index); }
          const object = index.get(row.id);
          if (!object || !kinds.has(object.kind) || captured.kind === "review" && object.kind !== "note") throw Error("対象の注釈が変更されています。");
        } else if (!page.sourceId || !/^\d+R\d*$/.test(row.id) || page.annotationEdits?.[row.id]?.deleted ||
          captured.kind === "review" && row.subtype !== "Text") throw Error("対象の既存注釈を確認できません。");
      }
      const changed = targets.filter(row => captured.kind === "delete" ||
        (captured.kind === "review" ? row.reviewStatus !== captured.status : row.author !== captured.author));
      if (!changed.length) return document;
      const grouped = new Map<string, typeof changed>();
      for (const row of changed) { const group = grouped.get(row.pageId) ?? []; group.push(row); grouped.set(row.pageId, group); }
      const patch = captured.kind === "review" ? { reviewStatus: captured.status } : captured.kind === "author" ? { author: captured.author } : { deleted: true };
      return { ...document, pages: document.pages.map(page => {
        const rows = grouped.get(page.id);
        if (!rows) return page;
        const objects = new Set(rows.filter(row => row.added).map(row => row.id));
        const markups = new Set(rows.filter(row => row.importedMarkup).map(row => row.id));
        const source = rows.filter(row => !row.added && !row.importedMarkup);
        return { ...page,
          objects: captured.kind === "delete" ? page.objects.filter(object => !objects.has(object.id)) :
            page.objects.map(object => objects.has(object.id) ? { ...object, ...patch } : object),
          ...(page.importedMarkups ? { importedMarkups: captured.kind === "delete" ? page.importedMarkups.filter(markup => !markups.has(markup.id)) :
            page.importedMarkups.map(markup => markups.has(markup.id) ? importedMarkupSchema.parse({ ...markup, ...patch }) : markup) } : {}),
          ...(source.length ? { annotationEdits: { ...page.annotationEdits,
            ...Object.fromEntries(source.map(row => [row.id, { ...page.annotationEdits?.[row.id], ...patch }])) } } : {}),
        };
      }) };
    } };
}
