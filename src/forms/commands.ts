import { change } from "../commands/document";
import type { FormFieldModel } from "../state/model";
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
