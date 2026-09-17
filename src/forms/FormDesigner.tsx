import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  uid,
  type DocumentModel,
  type FormFieldModel,
  type FormKind,
} from "../state/model";
import { documentStore } from "../state/store";
import { addFormField, removeFormField, updateFormField } from "./commands";
export const formKindLabels: Record<FormKind, string> = {
  text: "テキスト",
  checkbox: "チェックボックス",
  radio: "ラジオボタン",
  dropdown: "ドロップダウン",
  list: "リスト",
};
export function FormDesigner({
  model,
  active,
}: {
  model: DocumentModel;
  active: string;
}) {
  const [selected, setSelected] = useState("");
  const fields = model.formFields ?? [],
    field = fields.find((f) => f.id === selected);
  function add(kind: FormKind) {
    const page = model.pages.find((p) => p.id === active) ?? model.pages[0];
    const id = uid();
    documentStore.execute(
      addFormField({
        id,
        pageId: page.id,
        name: `Field_${id.slice(0, 8)}`,
        kind,
        x: 36,
        y: 60,
        width: kind === "checkbox" ? 20 : 220,
        height:
          kind === "radio" || kind === "list"
            ? 80
            : kind === "checkbox"
              ? 20
              : 30,
        value: kind === "checkbox" ? false : "",
        options:
          kind === "radio" || kind === "dropdown" || kind === "list"
            ? ["選択肢1", "選択肢2"]
            : [],
        fontSize: 12,
        required: false,
        readOnly: false,
        multiline: false,
      }),
    );
    setSelected(id);
  }
  const patch = (p: Partial<FormFieldModel>) =>
    field && documentStore.execute(updateFormField(field.id, p));
  return (
    <div className="form-designer">
      <p className="notice">
        フィールドを作成し、ページと位置を指定します。入力欄は保存後も他のPDFビューアーで再入力できます。単位はptです。
      </p>
      <div className="form-kind-buttons">
        {Object.entries(formKindLabels).map(([kind, label]) => (
          <button key={kind} onClick={() => add(kind as FormKind)}>
            <Plus size={14} />
            {label}
          </button>
        ))}
      </div>
      <label>
        作成したフィールド
        <select
          aria-label="作成したフィールド"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">選択してください</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {field && (
        <>
          <label>
            フィールド名
            <input
              aria-label="フィールド名"
              value={field.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label>
            配置ページ
            <select
              aria-label="配置ページ"
              value={field.pageId}
              onChange={(e) => patch({ pageId: e.target.value })}
            >
              {model.pages.map((p, i) => (
                <option key={p.id} value={p.id}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="property-grid">
            {(["x", "y", "width", "height"] as const).map((key) => (
              <label key={key}>
                {{ x: "X", y: "Y", width: "幅", height: "高さ" }[key]}
                <input
                  aria-label={`フィールド${key}`}
                  type="number"
                  value={field[key]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n))
                      patch({
                        [key]: Math.max(key === "x" || key === "y" ? 0 : 10, n),
                      });
                  }}
                />
              </label>
            ))}
          </div>
          <label>
            文字サイズ
            <input
              aria-label="フィールド文字サイズ"
              type="number"
              min={4}
              max={100}
              value={field.fontSize}
              onChange={(e) =>
                patch({
                  fontSize: Math.max(4, Math.min(100, Number(e.target.value))),
                })
              }
            />
          </label>
          {["radio", "dropdown", "list"].includes(field.kind) && (
            <label>
              選択肢（1行に1つ）
              <textarea
                aria-label="選択肢"
                value={field.options.join("\n")}
                onChange={(e) =>
                  patch({ options: e.target.value.split("\n"), value: "" })
                }
              />
            </label>
          )}
          <div className="form-flags">
            {(field.kind === "list" || field.kind === "dropdown") && (
              <label>
                <input
                  type="checkbox"
                  checked={!!field.multiSelect}
                  onChange={(e) =>
                    patch({
                      multiSelect: e.target.checked,
                      value: e.target.checked ? [] : "",
                    })
                  }
                />
                複数選択
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => patch({ required: e.target.checked })}
              />
              必須
            </label>
            <label>
              <input
                type="checkbox"
                checked={field.readOnly}
                onChange={(e) => patch({ readOnly: e.target.checked })}
              />
              読み取り専用
            </label>
            {field.kind === "text" && (
              <label>
                <input
                  type="checkbox"
                  checked={field.multiline}
                  onChange={(e) => patch({ multiline: e.target.checked })}
                />
                複数行
              </label>
            )}
          </div>
          {field.kind === "text" && (
            <label>
              最大文字数（空欄は制限なし）
              <input
                aria-label="最大文字数"
                type="number"
                min={1}
                max={1000000}
                value={field.maxLength ?? ""}
                onChange={(e) => {
                  const maxLength = e.target.value
                    ? Math.max(
                        1,
                        Math.min(1000000, Math.floor(Number(e.target.value))),
                      )
                    : undefined;
                  patch({
                    maxLength,
                    value: maxLength
                      ? String(field.value).slice(0, maxLength)
                      : field.value,
                  });
                }}
              />
            </label>
          )}
          <button
            className="danger"
            onClick={() => {
              documentStore.execute(removeFormField(field.id));
              setSelected("");
            }}
          >
            <Trash2 size={15} />
            フィールドを削除
          </button>
        </>
      )}
    </div>
  );
}
