import { editPage } from "../commands/document";
import type { AnnotationEdit } from "../state/model";
export const editAnnotation = (
  pageId: string,
  id: string,
  patch: AnnotationEdit,
) =>
  editPage(
    pageId,
    (p) => ({
      ...p,
      annotationEdits: {
        ...p.annotationEdits,
        [id]: { ...p.annotationEdits?.[id], ...patch },
      },
    }),
    patch.link || patch.box ? "リンクを編集" : "既存注釈を編集",
  );

export const resetAnnotationBox = (pageId: string, id: string) =>
  editPage(pageId, (p) => {
    const edit = p.annotationEdits?.[id];
    if (!edit?.box) return p;
    const next = { ...edit };
    delete next.box;
    return { ...p, annotationEdits: { ...p.annotationEdits, [id]: next } };
  }, "リンクの配置を戻す");
