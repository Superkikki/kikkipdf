import { change } from "../commands/document";
import type { DocumentModel, EditObject } from "../state/model";
export interface OcrRow {
  pageId: string;
  pageNumber: number;
  object: EditObject;
}
export function ocrRows(model: DocumentModel, pageId?: string): OcrRow[] {
  return model.pages.flatMap((p, i) =>
    !pageId || p.id === pageId
      ? p.objects
          .filter((o) => o.kind === "ocr")
          .map((object) => ({ pageId: p.id, pageNumber: i + 1, object }))
      : [],
  );
}
export function clearOcr(pageIds: string[]) {
  const ids = new Set(pageIds);
  return change("OCR結果を削除", (d) => ({
    ...d,
    pages: d.pages.map((p) =>
      ids.has(p.id)
        ? { ...p, objects: p.objects.filter((o) => o.kind !== "ocr") }
        : p,
    ),
  }));
}
export function reviewOcr(
  rows: Pick<OcrRow, "pageId" | "object">[],
  reviewed: boolean,
) {
  const ids = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!ids.has(row.pageId)) ids.set(row.pageId, new Set());
    ids.get(row.pageId)!.add(row.object.id);
  }
  return change(
    reviewed ? "OCR結果を確認済みにする" : "OCR結果を未確認に戻す",
    (d) => ({
      ...d,
      pages: d.pages.map((p) =>
        ids.has(p.id)
          ? {
              ...p,
              objects: p.objects.map((o) =>
                o.kind === "ocr" && ids.get(p.id)!.has(o.id)
                  ? { ...o, ocrReviewed: reviewed }
                  : o,
              ),
            }
          : p,
      ),
    }),
  );
}
