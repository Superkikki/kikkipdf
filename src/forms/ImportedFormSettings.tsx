import { useState } from "react";
import type { FormDescriptor } from "../export/engine";
import type { DocumentModel, ImportedFormEdit } from "../state/model";
import { documentStore } from "../state/store";
import { resetImportedForm, updateImportedForm } from "./commands";
import { resolveImportedForm } from "./importedSettings";
import { formKindLabels } from "./FormDesigner";

export function ImportedFormSettings({
  model,
  field,
}: {
  model: DocumentModel;
  field: FormDescriptor;
}) {
  const resolved = resolveImportedForm(field, model);
  const [draft, setDraft] = useState({
    name: resolved.name,
    required: !!resolved.required,
    readOnly: !!resolved.readOnly,
    multiline: !!resolved.multiline,
    multiSelect: !!resolved.multiSelect,
    maxLength:
      resolved.maxLength === undefined ? "" : String(resolved.maxLength),
    options: resolved.options.join("\n"),
  });
  const [error, setError] = useState("");
  const choice = field.kind === "dropdown" || field.kind === "list";
  const editableChoice = choice && !field.hasExportValues;
  const dirty =
    draft.name !== resolved.name ||
    draft.required !== !!resolved.required ||
    draft.readOnly !== !!resolved.readOnly ||
    (field.kind === "text" &&
      (draft.multiline !== !!resolved.multiline ||
        draft.maxLength !==
          (resolved.maxLength === undefined
            ? ""
            : String(resolved.maxLength)))) ||
    (editableChoice &&
      (draft.multiSelect !== !!resolved.multiSelect ||
        draft.options !== resolved.options.join("\n")));
  function apply() {
    const patch: ImportedFormEdit = {
      name: draft.name,
      required: draft.required,
      readOnly: draft.readOnly,
    };
    if (field.kind === "text") {
      patch.multiline = draft.multiline;
      patch.maxLength = draft.maxLength === "" ? null : Number(draft.maxLength);
    }
    if (editableChoice) {
      if (draft.options !== resolved.options.join("\n"))
        patch.options = draft.options.split(/\r?\n/);
      if (draft.multiSelect !== !!resolved.multiSelect)
        patch.multiSelect = draft.multiSelect;
    }
    try {
      documentStore.execute(updateImportedForm(field, patch));
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "フォームの設定を変更できません。",
      );
    }
  }
  return (
    <fieldset
      className="imported-form-settings"
      aria-label="既存フォームの設定編集"
    >
      <legend>入力欄の設定 — {formKindLabels[field.kind]}</legend>
      <p className="notice">
        設定は同じ項目の全ページに適用します。変更後に「設定を適用」を押してください。名前が重複する場合は保存時に連番が付きます。
      </p>
      <label>
        フィールド名
        <input
          aria-label="既存フィールド名"
          maxLength={500}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <div className="form-flags">
        <label>
          <input
            type="checkbox"
            aria-label="既存フィールド必須"
            checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
          />
          必須
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="既存フィールド読み取り専用"
            checked={draft.readOnly}
            onChange={(e) => setDraft({ ...draft, readOnly: e.target.checked })}
          />
          読み取り専用
        </label>
        {field.kind === "text" && (
          <label>
            <input
              type="checkbox"
              aria-label="既存フィールド複数行"
              checked={draft.multiline}
              onChange={(e) =>
                setDraft({ ...draft, multiline: e.target.checked })
              }
            />
            複数行
          </label>
        )}
        {editableChoice && (
          <label>
            <input
              type="checkbox"
              aria-label="既存フィールド複数選択"
              checked={draft.multiSelect}
              onChange={(e) =>
                setDraft({ ...draft, multiSelect: e.target.checked })
              }
            />
            複数選択
          </label>
        )}
      </div>
      {field.kind === "text" && (
        <label>
          最大文字数（空欄は制限なし）
          <input
            aria-label="既存フィールド最大文字数"
            type="number"
            min={1}
            max={1000000}
            step={1}
            value={draft.maxLength}
            onChange={(e) => setDraft({ ...draft, maxLength: e.target.value })}
          />
        </label>
      )}
      {editableChoice && (
        <>
          <label>
            選択肢（1行に1つ）
            <textarea
              aria-label="既存フィールド選択肢"
              rows={4}
              value={draft.options}
              onChange={(e) => setDraft({ ...draft, options: e.target.value })}
            />
          </label>
          <p className="hint">
            削除した選択肢の入力値は解除されます。複数選択を解除すると先頭の選択だけを残します。
          </p>
        </>
      )}
      {choice && field.hasExportValues && (
        <p className="notice">
          この欄は表示名と保存値が異なるため、選択肢・複数選択の変更は未対応です。名前・必須・読み取り専用は変更できます。
        </p>
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <div className="form-kind-buttons">
        <button disabled={!dirty} onClick={apply}>
          設定を適用
        </button>
        <button
          disabled={!model.importedFormEdits?.[field.key]}
          onClick={() => {
            try {
              documentStore.execute(resetImportedForm(field));
              setError("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "元の設定に戻せません。",
              );
            }
          }}
        >
          元の設定に戻す
        </button>
      </div>
    </fieldset>
  );
}
