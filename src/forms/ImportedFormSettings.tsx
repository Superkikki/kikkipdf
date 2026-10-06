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
    choiceOptions:
      resolved.choiceOptions ??
      resolved.options.map((value) => ({ value, label: value })),
  });
  const [error, setError] = useState("");
  const choice = field.kind === "dropdown" || field.kind === "list";
  const editableChoice = choice || field.kind === "radio";
  const pairedChoice = field.hasExportValues || !!resolved.choiceOptions?.some((o) => o.value !== o.label);
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
        draft.options !== resolved.options.join("\n") ||
        JSON.stringify(draft.choiceOptions) !==
          JSON.stringify(
            resolved.choiceOptions ??
              resolved.options.map((value) => ({ value, label: value })),
          )));
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
      if (
        pairedChoice &&
        JSON.stringify(draft.choiceOptions) !==
          JSON.stringify(resolved.choiceOptions)
      )
        patch.choiceOptions = draft.choiceOptions;
      if (
        !pairedChoice &&
        draft.options !== resolved.options.join("\n")
      )
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
        {choice && (
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
      {editableChoice &&
        !pairedChoice && (
          <>
            <label>
              選択肢（1行に1つ）
              <textarea
                aria-label="既存フィールド選択肢"
                rows={4}
                value={draft.options}
                onChange={(e) =>
                  setDraft({ ...draft, options: e.target.value })
                }
              />
            </label>
            <p className="hint">
              {field.kind === "radio" ? "現在と同じ件数で保存値を変更できます。選択中の入力欄は同じ位置を保持します。PDF本文のラベルは文字編集で変更してください。"
                : "削除した選択肢の入力値は解除されます。複数選択を解除すると先頭の選択だけを残します。"}
            </p>
          </>
        )}
      {choice &&
        pairedChoice && (
          <div className="choice-option-editor">
            <p className="hint">
              表示名は画面に表示され、保存値はPDFに記録されます。保存値は重複できません。
            </p>
            {draft.choiceOptions.map((option, index) => (
              <div className="form-kind-buttons" key={index}>
                <label>
                  表示名
                  <input
                    aria-label={`選択肢${index + 1}の表示名`}
                    value={option.label}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        choiceOptions: draft.choiceOptions.map((o, i) =>
                          i === index ? { ...o, label: e.target.value } : o,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  保存値
                  <input
                    aria-label={`選択肢${index + 1}の保存値`}
                    value={option.value}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        choiceOptions: draft.choiceOptions.map((o, i) =>
                          i === index ? { ...o, value: e.target.value } : o,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  aria-label={`選択肢${index + 1}を削除`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      choiceOptions: draft.choiceOptions.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  削除
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  choiceOptions: [
                    ...draft.choiceOptions,
                    { value: "", label: "" },
                  ],
                })
              }
            >
              選択肢を追加
            </button>
            <p className="hint">
              削除した保存値の選択は解除されます。複数選択を解除すると先頭の選択だけを残します。
            </p>
          </div>
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
