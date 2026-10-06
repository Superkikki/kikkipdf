import type { DocumentModel, FieldValue } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import { resolveImportedForm, normalizeChoiceValue } from "./importedSettings";
import { change } from "../commands/document";

export type DataField = Pick<FormDescriptor, "key" | "name" | "kind" | "value" | "options" | "choiceOptions" | "readOnly" | "multiSelect" | "maxLength" | "multiline" | "checkboxOnValue">;
export function dataFields(model: DocumentModel, imported: FormDescriptor[]): DataField[] {
  return [
    ...imported.filter(field => field.widgets.some(widget => model.pages.some(page =>
      page.sourceId === field.sourceId && page.sourceIndex === widget.pageIndex))).map(field => resolveImportedForm(field, model)),
    ...(model.formFields ?? []).filter(field => model.pages.some(page => page.id === field.pageId))
      .map(field => ({ ...field, key: `new:${field.id}`, checkboxOnValue: "Yes" })),
  ];
}
export function validateDataValue(field: DataField, values: string[]): FieldValue {
  const error = (message: string): never => { throw Error(`${field.name}: ${message}`); };
  if (values.some(value => value.length > 1_000_000)) error("入力値が長すぎます。");
  if (field.kind === "text") {
    if (values.length !== 1) error("テキスト欄は値を1つ指定してください。");
    if (!field.multiline && /[\r\n]/.test(values[0])) error("改行を読み込むには複数行の欄にしてください。");
    if (field.maxLength !== undefined && values[0].length > field.maxLength) error("最大文字数を超えています。");
    return values[0];
  }
  if (field.kind === "checkbox") {
    if (values.length !== 1 || !["Off", field.checkboxOnValue ?? "Yes"].includes(values[0])) error("チェックボックスの保存値が不正です。");
    return values[0] !== "Off";
  }
  if (!field.multiSelect && values.length > 1) error("複数選択できない欄です。");
  const options = field.choiceOptions?.map(option => option.value) ?? field.options;
  if (new Set(values).size !== values.length) error("選択値が重複しています。");
  if (values.some(value => value !== "" && !options.includes(value))) error("選択肢にない保存値です。");
  if (field.multiSelect && values.includes("")) error("複数選択の空値はvalue要素を省略してください。");
  return field.multiSelect ? values : values[0] ?? "";
}
export function formValueStrings(field: DataField): string[] {
  if (field.kind === "checkbox") return [field.value ? field.checkboxOnValue ?? "Yes" : "Off"];
  if (Array.isArray(field.value)) return field.value.length || field.multiSelect ? field.value : [""];
  return [String(field.value)];
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
  return change("フォーム値を読み込み時に戻す", model => {
    const current = dataFields(model, imported), originals = new Map(imported.map(field => [field.key, field]));
    const values = new Map<string, FieldValue>();
    for (const field of current.filter(field => !field.readOnly)) {
      const original = originals.get(field.key);
      let value: FieldValue = original?.value ?? emptyValue(field);
      if (original && field.kind === "radio") value = field.options[original.options.indexOf(String(value))] ?? "";
      if (field.kind === "list" || field.kind === "dropdown") value = normalizeChoiceValue(value, field.choiceOptions?.map(option => option.value) ?? field.options, !!field.multiSelect);
      value = validateDataValue(field, formValueStrings({ ...field, value }));
      if (JSON.stringify(formValueStrings({ ...field, value })) !== JSON.stringify(formValueStrings(field))) values.set(field.key, value);
    }
    if (!values.size) return model;
    return { ...model, formValues: { ...model.formValues, ...Object.fromEntries([...values].filter(([key]) => !key.startsWith("new:"))) },
      formFields: model.formFields?.map(field => values.has(`new:${field.id}`) ? { ...field, value: values.get(`new:${field.id}`)! } : field) };
  });
}
