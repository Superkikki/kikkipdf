import type { DocumentModel, ReviewStatus, Source } from "../state/model";
import { sourcePdf } from "../viewer/pdf";

export const reviewStatuses: Record<ReviewStatus, string> = {
  None: "未確認", Accepted: "承認", Rejected: "却下", Cancelled: "取消", Completed: "完了",
};
export interface ImportedComment {
  id: string; sourceId: string; sourceIndex: number; text: string; author: string;
  reviewStatus: ReviewStatus; reviewable: boolean;
}
export interface CommentRow {
  id: string; key: string; pageId: string; pageIndex: number; text: string; author: string;
  reviewStatus: ReviewStatus; reviewable: boolean; added: boolean; editable: boolean;
}
const markup = new Set(["Text", "Highlight", "Underline", "StrikeOut", "Squiggly", "Ink", "FreeText", "Stamp", "Caret", "Circle", "Square", "Polygon", "PolyLine"]);
const cache = new WeakMap<Uint8Array, Promise<Omit<ImportedComment, "sourceId">[]>>();

export async function readComments(source: Source): Promise<ImportedComment[]> {
  let ready = cache.get(source.bytes);
  if (!ready) {
    ready = (async () => {
      const pdf = await sourcePdf(source);
      const result: Omit<ImportedComment, "sourceId">[] = [];
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1);
        for (const annotation of await page.getAnnotations()) {
          if (!markup.has(annotation.subtype)) continue;
          const reviewable = annotation.subtype === "Text";
          const state = annotation.stateModel === "Review" && Object.hasOwn(reviewStatuses, annotation.state)
            ? annotation.state as ReviewStatus : "None";
          result.push({ id: String(annotation.id), sourceIndex: i, text: String(annotation.contentsObj?.str ?? ""),
            author: String(annotation.titleObj?.str ?? ""), reviewStatus: state, reviewable });
        }
        if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return result;
    })();
    cache.set(source.bytes, ready);
    ready.catch(() => cache.delete(source.bytes));
  }
  return (await ready).map((comment) => ({ ...comment, sourceId: source.id }));
}

export function buildComments(model: DocumentModel, imported: ImportedComment[]): CommentRow[] {
  const byPage = new Map<string, ImportedComment[]>();
  for (const comment of imported) {
    const key = `${comment.sourceId}:${comment.sourceIndex}`;
    const group = byPage.get(key) ?? [];
    group.push(comment);
    byPage.set(key, group);
  }
  return model.pages.flatMap((page, pageIndex) => [
    ...(byPage.get(`${page.sourceId}:${page.sourceIndex}`) ?? [])
      .filter((comment) => !page.annotationEdits?.[comment.id]?.deleted)
      .map((comment) => ({ id: comment.id, key: `${page.id}:${comment.id}`, pageId: page.id, pageIndex,
        text: page.annotationEdits?.[comment.id]?.text ?? comment.text,
        author: page.annotationEdits?.[comment.id]?.author ?? comment.author,
        reviewStatus: page.annotationEdits?.[comment.id]?.reviewStatus ?? comment.reviewStatus,
        reviewable: comment.reviewable, added: false, editable: /^\d+R\d*$/.test(comment.id) })),
    ...page.objects.filter((object) => object.kind === "note").map((object) => ({
      id: object.id, key: object.id, pageId: page.id, pageIndex, text: object.text ?? "", author: object.author ?? "",
      reviewStatus: object.reviewStatus ?? "None", reviewable: true, added: true, editable: true,
    })),
  ]);
}

export interface CommentFilters { query: string; author: string; status: string; pageId: string }
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
export function filterComments(comments: CommentRow[], filters: CommentFilters) {
  const query = normalized(filters.query.trim());
  return comments.filter((comment) => (!query || normalized(`${comment.text}\n${comment.author}`).includes(query)) &&
    (!filters.author || comment.author === filters.author) &&
    (!filters.status || (comment.reviewable && comment.reviewStatus === filters.status)) &&
    (!filters.pageId || comment.pageId === filters.pageId));
}
