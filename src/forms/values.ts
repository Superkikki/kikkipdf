import type { FieldValue } from "../state/model";
import type { DataField } from "./data";

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
export function validateDefaultValue(field: DataField, value: FieldValue): FieldValue {
  if (field.kind === "checkbox" ? typeof value !== "boolean"
    : field.kind === "text" || field.kind === "radio" ? typeof value !== "string"
    : typeof value === "boolean") throw Error(`${field.name}: 既定値の型が不正です。`);
  return validateDataValue(field, formValueStrings({ ...field, value }));
}
