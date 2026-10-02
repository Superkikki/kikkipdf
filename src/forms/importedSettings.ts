import { z } from "zod";
import type { FormDescriptor } from "../export/engine";
import type {
  DocumentModel,
  FieldValue,
  ImportedFormEdit,
} from "../state/model";

export const importedFormEditSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(500)
      .refine((v) => !!v.trim())
      .optional(),
    required: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    multiline: z.boolean().optional(),
    multiSelect: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(1000000).nullable().optional(),
    options: z
      .array(
        z
          .string()
          .min(1)
          .max(100000)
          .refine((v) => !!v.trim()),
      )
      .min(1)
      .max(10000)
      .refine((v) => new Set(v).size === v.length)
      .optional(),
  })
  .strict();

export function validateImportedFormEdit(
  field: Pick<FormDescriptor, "name" | "kind" | "hasExportValues">,
  edit: ImportedFormEdit,
): ImportedFormEdit {
  const parsed = importedFormEditSchema.safeParse(edit);
  if (!parsed.success)
    throw Error(
      "フィールド名・最大文字数・選択肢を確認してください。選択肢は空欄と重複を除いてください。",
    );
  const result = parsed.data;
  if (
    field.kind !== "text" &&
    (result.multiline !== undefined || result.maxLength !== undefined)
  )
    throw Error("複数行と最大文字数はテキスト欄で変更できます。");
  if (
    field.kind !== "dropdown" &&
    field.kind !== "list" &&
    (result.options !== undefined || result.multiSelect !== undefined)
  )
    throw Error("選択肢と複数選択はドロップダウン・リストで変更できます。");
  if (
    field.hasExportValues &&
    (result.options !== undefined || result.multiSelect !== undefined)
  )
    throw Error(
      "表示名と保存値が異なる選択欄の選択肢・複数選択の変更は未対応です。",
    );
  return result;
}

export function normalizeChoiceValue(
  value: FieldValue,
  options: string[],
  multiSelect: boolean,
): FieldValue {
  const selected = (
    Array.isArray(value) ? value : value ? [String(value)] : []
  ).filter((v) => options.includes(v));
  return multiSelect ? [...new Set(selected)] : (selected[0] ?? "");
}

export function resolveImportedForm(
  field: FormDescriptor,
  model: Pick<DocumentModel, "formValues" | "importedFormEdits">,
): FormDescriptor {
  const edit = model.importedFormEdits?.[field.key] ?? {};
  const value = model.formValues[field.key] ?? field.value;
  const resolved = {
    ...field,
    ...edit,
    maxLength:
      edit.maxLength === null ? undefined : (edit.maxLength ?? field.maxLength),
    value,
  };
  if (
    (field.kind === "dropdown" || field.kind === "list") &&
    (edit.options !== undefined || edit.multiSelect !== undefined)
  )
    resolved.value = normalizeChoiceValue(
      value,
      resolved.options,
      !!resolved.multiSelect,
    );
  return resolved;
}
