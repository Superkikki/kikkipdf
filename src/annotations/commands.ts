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
    patch.link ? "リンクを編集" : "既存注釈を編集",
  );
