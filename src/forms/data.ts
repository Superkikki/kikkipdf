import type { DocumentModel, FieldValue } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import { resolveImportedForm, normalizeChoiceValue } from "./importedSettings";
import { validateDataValue, formValueStrings, validateDefaultValue } from "./values";
export { validateDataValue, formValueStrings } from "./values";
import { change } from "../commands/document";

export type DataField = Pick<FormDescriptor, "key" | "name" | "kind" | "value" | "options" | "choiceOptions" | "readOnly" | "multiSelect" | "maxLength" | "multiline" | "checkboxOnValue" | "defaultValue" | "defaultValueError">;
export function dataFields(model: DocumentModel, imported: FormDescriptor[]): DataField[] {
  return [
    ...imported.filter(field => field.widgets.some(widget => model.pages.some(page =>
      page.sourceId === field.sourceId && page.sourceIndex === widget.pageIndex))).map(field => resolveImportedForm(field, model)).filter(field => !field.deleted),
    ...(model.formFields ?? []).filter(field => model.pages.some(page => page.id === field.pageId))
      .map(field => ({ ...field, key: `new:${field.id}`, checkboxOnValue: "Yes" })),
  ];
}
export function applyFormData(imported: FormDescriptor[], entries: { name: string; values: string[] }[]) {
  const captured = structuredClone(entries);
  return change("XFDFフォーム値を読み込み", model => {
    if (!captured.length || captured.length > 5000) throw Error("フォーム値は1〜5000項目にしてください。");
    const fields = dataFields(model, imported), names = new Set<string>();
    const updates = new Map<string, FieldValue>();
    for (const entry of captured) {
      if (names.has(entry.name)) throw Error(`フォーム名が重複しています: ${entry.name}`);
      names.add(entry.name);
      const matches = fields.filter(field => field.name === entry.name);
      if (matches.length !== 1) throw Error(`フォーム名が見つからないか重複しています: ${entry.name}`);
      const field = matches[0], value = validateDataValue(field, entry.values);
      const changed = JSON.stringify(formValueStrings({ ...field, value })) !== JSON.stringify(formValueStrings(field));
      if (field.readOnly && changed) throw Error(`読み取り専用の欄は変更できません: ${field.name}`);
      if (changed) updates.set(field.key, value);
    }
    if (!updates.size) return model;
    return { ...model, formValues: { ...model.formValues, ...Object.fromEntries([...updates].filter(([key]) => !key.startsWith("new:"))) },
      formFields: model.formFields?.map(field => updates.has(`new:${field.id}`) ? { ...field, value: updates.get(`new:${field.id}`)! } : field) };
  });
}
const emptyValue = (field: DataField): FieldValue => field.kind === "checkbox" ? false : field.multiSelect ? [] : "";
export function restoreFormData(imported: FormDescriptor[]) {
  return resetFormData(imported, false);
}
export function resetFormDataToDefaults(imported: FormDescriptor[]) {
  return resetFormData(imported, true);
}
function resetFormData(imported: FormDescriptor[], defaults: boolean) {
  return change(defaults ? "フォーム値をPDFの既定値に戻す" : "フォーム値を読み込み時に戻す", model => {
    const current = dataFields(model, imported), originals = new Map(imported.map(field => [field.key, field]));
    const values = new Map<string, FieldValue>();
    for (const field of current.filter(field => !field.readOnly)) {
      const original = originals.get(field.key);
      if (defaults && field.defaultValueError) throw Error(`${field.name}: ${field.defaultValueError}`);
      let value: FieldValue = (defaults ? field.defaultValue : original?.value) ?? emptyValue(field);
      if (!defaults && original && field.kind === "radio") value = field.options[original.options.indexOf(String(value))] ?? "";
      if (!defaults && (field.kind === "list" || field.kind === "dropdown")) value = normalizeChoiceValue(value, field.choiceOptions?.map(option => option.value) ?? field.options, !!field.multiSelect);
      value = validateDataValue(field, formValueStrings({ ...field, value }));
      if (JSON.stringify(formValueStrings({ ...field, value })) !== JSON.stringify(formValueStrings(field))) values.set(field.key, value);
    }
    if (!values.size) return model;
    return { ...model, formValues: { ...model.formValues, ...Object.fromEntries([...values].filter(([key]) => !key.startsWith("new:"))) },
      formFields: model.formFields?.map(field => values.has(`new:${field.id}`) ? { ...field, value: values.get(`new:${field.id}`)! } : field) };
  });
}

/** Set or remove defaults atomically without changing current input values. */
export function setFormDefaults(imported: FormDescriptor[], clear = false) {
  return change(clear ? "フォームの既定値を解除" : "現在の入力値を既定値に設定", model => {
    const fields = dataFields(model, imported).filter(field => !field.readOnly);
    const edits = { ...model.importedFormEdits };
    const added = new Map<string, FieldValue | undefined>();
    let changed = false;
    for (const field of fields) {
      const value = clear ? undefined : validateDefaultValue(field, field.value);
      if (!field.defaultValueError && JSON.stringify(field.defaultValue) === JSON.stringify(value)) continue;
      changed = true;
      if (field.key.startsWith("new:")) added.set(field.key.slice(4), value);
      else edits[field.key] = { ...edits[field.key], defaultValue: value ?? null };
    }
    if (!changed) return model;
    return { ...model, importedFormEdits: edits,
      formFields: model.formFields?.map(field => added.has(field.id)
        ? { ...field, defaultValue: added.get(field.id) } : field) };
  });
}
