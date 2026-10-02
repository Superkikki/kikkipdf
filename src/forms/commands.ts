import { change } from "../commands/document";
import type { Box, FormFieldModel, ImportedFormEdit } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import {
  normalizeChoiceValue,
  resolveImportedForm,
  validateImportedFormEdit,
} from "./importedSettings";
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

export const updateImportedForm = (
  field: FormDescriptor,
  patch: ImportedFormEdit,
) =>
  change("既存フォームの設定変更", (d) => {
    if (!d.sources[field.sourceId]) throw Error("参照元PDFがありません。");
    const edit = validateImportedFormEdit(field, {
      ...d.importedFormEdits?.[field.key],
      ...patch,
    });
    const importedFormEdits = { ...d.importedFormEdits, [field.key]: edit };
    const resolved = resolveImportedForm(field, { ...d, importedFormEdits });
    if (
      field.kind === "text" &&
      resolved.maxLength !== undefined &&
      String(resolved.value).length > resolved.maxLength
    )
      throw Error(
        "現在の入力値より短い最大文字数には変更できません。先に入力値を修正してください。",
      );
    return {
      ...d,
      importedFormEdits,
      formValues:
        JSON.stringify(resolved.value) ===
        JSON.stringify(d.formValues[field.key] ?? field.value)
          ? d.formValues
          : { ...d.formValues, [field.key]: resolved.value },
    };
  });

export const resetImportedForm = (field: FormDescriptor) =>
  change("既存フォームの設定を戻す", (d) => {
    if (!d.importedFormEdits?.[field.key]) return d;
    const importedFormEdits = { ...d.importedFormEdits };
    delete importedFormEdits[field.key];
    const value = d.formValues[field.key] ?? field.value;
    if (
      field.kind === "text" &&
      field.maxLength !== undefined &&
      String(value).length > field.maxLength
    )
      throw Error(
        "元の最大文字数を超える入力値があります。先に入力値を修正してください。",
      );
    const nextValue =
      (field.kind === "dropdown" || field.kind === "list") &&
      !field.hasExportValues
        ? normalizeChoiceValue(value, field.options, !!field.multiSelect)
        : value;
    return {
      ...d,
      importedFormEdits,
      formValues:
        JSON.stringify(nextValue) === JSON.stringify(value)
          ? d.formValues
          : { ...d.formValues, [field.key]: nextValue },
    };
  });
