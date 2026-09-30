import { change } from "../commands/document";
import type { Box, FormFieldModel } from "../state/model";
import { editPage } from "../commands/document";
export const widgetKey = (name: string, index: number) =>
  JSON.stringify([name, index]);
export const updateFormWidget = (pageId: string, id: string, box: Box) => {
  if (
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    Math.abs(box.x) > 1e6 ||
    Math.abs(box.y) > 1e6 ||
    box.width > 100000 ||
    box.height > 100000 ||
    box.width < 1 ||
    box.height < 1
  )
    throw Error("フォームの位置とサイズを確認してください。");
  return editPage(
    pageId,
    (p) => ({
      ...p,
      formWidgetEdits: { ...p.formWidgetEdits, [id]: { ...box } },
    }),
    "既存フォームの配置変更",
  );
};
export const resetFormWidget = (pageId: string, id: string) =>
  editPage(
    pageId,
    (p) => {
      if (!p.formWidgetEdits?.[id]) return p;
      const edits = { ...p.formWidgetEdits };
      delete edits[id];
      return { ...p, formWidgetEdits: edits };
    },
    "既存フォームの配置を戻す",
  );
export const addFormField = (field: FormFieldModel) =>
  change("フォームフィールド追加", (d) => ({
    ...d,
    formFields: [...(d.formFields ?? []), field],
  }));
export const updateFormField = (id: string, patch: Partial<FormFieldModel>) =>
  change("フォームフィールド編集", (d) => ({
    ...d,
    formFields: (d.formFields ?? []).map((f) =>
      f.id === id ? { ...f, ...patch } : f,
    ),
  }));
export const removeFormField = (id: string) =>
  change("フォームフィールド削除", (d) => ({
    ...d,
    formFields: (d.formFields ?? []).filter((f) => f.id !== id),
  }));
