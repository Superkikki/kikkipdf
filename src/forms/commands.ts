import { change } from "../commands/document";
import { uid, type Box, type FormFieldModel, type ImportedFormEdit } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import {
  validateEditedDefault,
  normalizeChoiceValue,
  resolveImportedForm,
  validateImportedFormEdit,
} from "./importedSettings";
import { validateDataValue, formValueStrings, validateDefaultValue } from "./values";
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
      ...(patch.choiceOptions
        ? { options: undefined }
        : patch.options
          ? { choiceOptions: undefined }
          : {}),
      ...patch,
    });
    if (field.kind === "radio" && patch.options && patch.defaultValue === undefined && edit.defaultValue != null) {
      const previous = resolveImportedForm(field, d);
      const index = previous.options.indexOf(String(previous.defaultValue));
      edit.defaultValue = index >= 0 ? patch.options[index] : "";
    }
    const importedFormEdits = { ...d.importedFormEdits, [field.key]: edit };
    let formValues = d.formValues;
    if (field.kind === "radio" && patch.options) {
      const previous = resolveImportedForm(field, d), index = previous.options.indexOf(String(previous.value));
      formValues = { ...formValues, [field.key]: index >= 0 ? patch.options[index] : "" };
    }
    const resolved = resolveImportedForm(field, { ...d, formValues, importedFormEdits });
    validateEditedDefault(resolved, edit);
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
          ? formValues
          : { ...formValues, [field.key]: resolved.value },
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
    const currentOptions = d.importedFormEdits[field.key].options;
    const radioIndex = currentOptions?.indexOf(String(value)) ?? -1;
    const nextValue = field.kind === "radio" && currentOptions
      ? radioIndex >= 0 ? field.options[radioIndex] : ""
      : field.kind === "dropdown" || field.kind === "list"
        ? normalizeChoiceValue(
            value,
            field.choiceOptions?.map((o) => o.value) ?? field.options,
            !!field.multiSelect,
          )
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

/** Deletion applies to the entire shared field, including every source widget. */
export function setImportedFormDeleted(field: FormDescriptor, deleted: boolean) {
  return change(deleted ? "既存フォーム項目を削除" : "既存フォーム項目を復元", model => {
    if (!model.sources[field.sourceId]) throw Error("参照元PDFがありません。");
    const previous = model.importedFormEdits?.[field.key] ?? {};
    if (!!previous.deleted === deleted) return model;
    const edit = validateImportedFormEdit(field, { ...previous, deleted });
    if (!deleted) {
      const resolved = resolveImportedForm(field, { ...model, importedFormEdits: { ...model.importedFormEdits, [field.key]: edit } });
      validateEditedDefault(resolved, edit);
      validateDataValue(resolved, formValueStrings(resolved));
    }
    return { ...model, importedFormEdits: { ...model.importedFormEdits, [field.key]: edit } };
  });
}

/** Rebuild a supported field as an independent added field. No source refs are shared. */
export function duplicateImportedForm(fields: FormDescriptor[], key: string, pageId: string, widgetId: string) {
  const id = uid(), captured = structuredClone(fields);
  return change("既存フォームを独立して複製", model => {
    const original = captured.find(field => field.key === key);
    const page = model.pages.find(page => page.id === pageId);
    const widget = original?.widgets.find(widget => widget.id === widgetId);
    if (!original || !model.sources[original.sourceId] || !page || !widget || page.sourceId !== original.sourceId || page.sourceIndex !== widget.pageIndex)
      throw Error("複製する入力欄の参照先がありません。");
    const field = resolveImportedForm(original, model);
    if (field.deleted) throw Error("削除済みの項目は先に復元してください。");
    if ((model.formFields?.length ?? 0) >= 10000) throw Error("追加フォームは10000項目までです。");
    if (field.defaultValueError) throw Error(`${field.name}: ${field.defaultValueError}`);
    const value = validateDataValue(field, formValueStrings(field));
    const defaultValue = field.defaultValue === undefined ? undefined : validateDefaultValue(field, field.defaultValue);
    const names = new Set([...captured.map(field => resolveImportedForm(field, model).name),
      ...(model.formFields ?? []).map(field => field.name)]);
    let suffix = "_copy", index = 2;
    let name = field.name.slice(0, 500 - suffix.length) + suffix;
    while (names.has(name)) {
      suffix = `_copy${index++}`;
      name = field.name.slice(0, 500 - suffix.length) + suffix;
    }
    const sourceBox = page.formWidgetEdits?.[widget.id] ?? widget;
    const width = field.kind === "radio" ? Math.max(160, sourceBox.width) : Math.max(10, sourceBox.width);
    const height = field.kind === "radio" ? Math.max(20 * field.options.length, sourceBox.height) : Math.max(10, sourceBox.height);
    if (![width, height, sourceBox.x, sourceBox.y].every(Number.isFinite) || width > 100000 || height > 100000)
      throw Error("複製する入力欄の位置とサイズを確認してください。");
    const created: FormFieldModel = {
      id, pageId, name, kind: field.kind, value, defaultValue,
      options: [...field.options], choiceOptions: field.kind === "dropdown" || field.kind === "list" ? field.choiceOptions?.map(option => ({ ...option })) : undefined,
      x: Math.max(0, Math.min(Math.max(0, page.width - width), sourceBox.x + 12)),
      y: Math.max(0, Math.min(Math.max(0, page.height - height), sourceBox.y + 12)), width, height,
      fontSize: Math.max(4, Math.min(100, field.fontSize)), required: !!field.required,
      readOnly: !!field.readOnly, multiline: !!field.multiline, multiSelect: field.multiSelect, maxLength: field.maxLength,
    };
    return { ...model, formFields: [...(model.formFields ?? []), created] };
  });
}
