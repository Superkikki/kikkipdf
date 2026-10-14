import { validateDefaultValue } from "./values";
import { PDFArray, PDFCheckBox, PDFDropdown, PDFHexString, PDFName, PDFNull, PDFOptionList, PDFRadioGroup, PDFString, PDFTextField, type PDFField } from "pdf-lib";
import type { FieldValue } from "../state/model";

/** Decode inherited /DV without changing /V or widget appearance states. */
export function inspectDefaultValue(field: PDFField): { defaultValue?: FieldValue; defaultValueError?: string } {
  try {
    const raw = field.acroField.getInheritableAttribute(PDFName.of("DV"));
    const value = field.doc.context.lookup(raw);
    if (!value || value === PDFNull) return {};
    const invalid = (): never => { throw Error("PDFの既定値（DV）が不正か、対応していない形式です。"); };
    const text = (item: unknown): string => item instanceof PDFString || item instanceof PDFHexString ? item.decodeText() : invalid();
    if (field instanceof PDFTextField) return { defaultValue: text(value) };
    if (field instanceof PDFCheckBox) {
      if (!(value instanceof PDFName)) return invalid();
      if (value === PDFName.of("Off")) return { defaultValue: false };
      if (value !== field.acroField.getOnValue()) return invalid();
      return { defaultValue: true };
    }
    if (field instanceof PDFRadioGroup) {
      if (!(value instanceof PDFName)) return invalid();
      if (value === PDFName.of("Off")) return { defaultValue: "" };
      const index = field.acroField.getOnValues().indexOf(value);
      if (index < 0) return invalid();
      const exports = field.acroField.getExportValues();
      return { defaultValue: exports ? exports[index]?.decodeText() ?? invalid() : value.decodeText() };
    }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const values = value instanceof PDFArray
        ? value.asArray().map(item => text(field.doc.context.lookup(item))) : [text(value)];
      if ((!field.isMultiselect() && values.length > 1) || new Set(values).size !== values.length) return invalid();
      const options = field.acroField.getOptions().map(option => option.value.decodeText());
      if (values.some(item => item !== "" && !options.includes(item))) return invalid();
      return { defaultValue: field.isMultiselect() ? values : values[0] ?? "" };
    }
    return invalid();
  } catch (reason) {
    return { defaultValueError: reason instanceof Error ? reason.message : "PDFの既定値を読み込めません。" };
  }
}

/** Write only /DV; /V and all widget appearance states remain untouched. */
export function setFieldDefaultValue(field: PDFField, value: FieldValue) {
  const kind = field instanceof PDFTextField ? "text" : field instanceof PDFCheckBox ? "checkbox"
    : field instanceof PDFRadioGroup ? "radio" : field instanceof PDFDropdown ? "dropdown"
    : field instanceof PDFOptionList ? "list" : undefined;
  if (!kind) throw Error("この種類のフォーム既定値には対応していません。");
  const choice = field instanceof PDFDropdown || field instanceof PDFOptionList;
  const options = choice ? field.acroField.getOptions().map(option => option.value.decodeText())
    : field instanceof PDFRadioGroup ? field.getOptions() : [];
  const checked = validateDefaultValue({ key: field.getName(), name: field.getName(), kind, value, options,
    checkboxOnValue: field instanceof PDFCheckBox ? field.acroField.getOnValue()?.decodeText() : undefined,
    multiSelect: choice && field.isMultiselect(),
    multiline: field instanceof PDFTextField && field.isMultiline(),
    maxLength: field instanceof PDFTextField ? field.getMaxLength() : undefined }, value);
  const dict = field.acroField.dict;
  if (field instanceof PDFCheckBox) {
    const on = field.acroField.getOnValue();
    if (checked && !on) throw Error(`${field.getName()}: チェックボックスのON値がありません。`);
    dict.set(PDFName.of("DV"), checked ? on! : PDFName.of("Off"));
  } else if (field instanceof PDFRadioGroup) {
    const index = options.indexOf(String(checked));
    dict.set(PDFName.of("DV"), checked === "" ? PDFName.of("Off") : field.acroField.getOnValues()[index]);
  } else {
    dict.set(PDFName.of("DV"), Array.isArray(checked)
      ? dict.context.obj(checked.map(item => PDFHexString.fromText(item)))
      : PDFHexString.fromText(String(checked)));
  }
}
