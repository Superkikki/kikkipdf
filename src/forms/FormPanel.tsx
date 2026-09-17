import { useEffect, useState } from "react";
import type { DocumentModel, FieldValue } from "../state/model";
import { loadForms } from "../export/client";
import type { FormDescriptor } from "../export/engine";
import { documentStore } from "../state/store";
import { FormDesigner } from "./FormDesigner";
import { updateFormField } from "./commands";
import { change } from "../commands/document";
export function FormPanel({
  model,
  active,
}: {
  model: DocumentModel;
  active: string;
}) {
  const [fields, setFields] = useState<FormDescriptor[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("fill");
  const sources = model.sources;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void loadForms({ sources })
      .then((f) => {
        if (live) setFields(f);
      })
      .catch(() => {
        if (live)
          setError("フォームを読み込めません。XFAフォームは未対応です。");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [sources]);
  function update(key: string, value: FieldValue) {
    if (key.startsWith("new:")) {
      documentStore.execute(updateFormField(key.slice(4), { value }));
      return;
    }
    documentStore.execute(
      change("フォーム入力", (d) => ({
        ...d,
        formValues: { ...d.formValues, [key]: value },
      })),
    );
  }
  return (
    <div className="dialog-body">
      <div className="form-kind-buttons">
        <button
          className={tab === "fill" ? "active" : ""}
          onClick={() => setTab("fill")}
        >
          値を入力
        </button>
        <button
          className={tab === "design" ? "active" : ""}
          onClick={() => setTab("design")}
        >
          フォームを作成・編集
        </button>
      </div>
      <label className="form-flatten">
        <input
          type="checkbox"
          checked={!!model.flattenForms}
          onChange={(e) =>
            documentStore.execute(
              change("フォーム保存方式", (d) => ({
                ...d,
                flattenForms: e.target.checked,
              })),
            )
          }
        />
        固定して保存（保存後は再入力不可）
      </label>
      {tab === "design" ? (
        <FormDesigner model={model} active={active} />
      ) : (
        <>
          <p className="notice">
            標準AcroFormを保持して保存します。入力欄の外観は保存後に更新されます。同名フィールドの結合時は名前に連番が付きます。XFA・計算スクリプトは未対応です。
          </p>
          {loading && <p>フォームを読み込み中…</p>}
          {error && <p className="warning">{error}</p>}
          {!loading &&
            !fields.length &&
            !model.formFields?.length &&
            !error && (
              <p>このPDFには対応するフォームフィールドがありません。</p>
            )}
          {[
            ...fields,
            ...(model.formFields ?? []).map((f) => ({
              ...f,
              key: "new:" + f.id,
            })),
          ].map((f) => {
            const value = f.key.startsWith("new:")
              ? f.value
              : (model.formValues[f.key] ?? f.value);
            return (
              <label key={f.key}>
                {f.name}
                {f.kind === "checkbox" ? (
                  <input
                    aria-label={f.name}
                    disabled={f.readOnly}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => update(f.key, e.target.checked)}
                  />
                ) : f.kind === "text" ? (
                  f.multiline ? (
                    <textarea
                      aria-label={f.name}
                      readOnly={f.readOnly}
                      maxLength={f.maxLength}
                      value={String(value)}
                      onChange={(e) => update(f.key, e.target.value)}
                      rows={4}
                    />
                  ) : (
                    <input
                      aria-label={f.name}
                      readOnly={f.readOnly}
                      maxLength={f.maxLength}
                      value={String(value)}
                      onChange={(e) => update(f.key, e.target.value)}
                    />
                  )
                ) : (
                  <select
                    aria-label={f.name}
                    disabled={f.readOnly}
                    multiple={f.multiSelect}
                    size={
                      f.kind === "list" || f.multiSelect
                        ? Math.min(6, Math.max(2, f.options.length))
                        : undefined
                    }
                    value={
                      f.multiSelect
                        ? Array.isArray(value)
                          ? value
                          : value
                            ? [String(value)]
                            : []
                        : Array.isArray(value)
                          ? (value[0] ?? "")
                          : String(value)
                    }
                    onChange={(e) =>
                      update(
                        f.key,
                        f.multiSelect
                          ? Array.from(e.target.selectedOptions).map(
                              (o) => o.value,
                            )
                          : e.target.value,
                      )
                    }
                  >
                    {!f.multiSelect && (
                      <option value="">選択してください</option>
                    )}
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                )}
              </label>
            );
          })}
        </>
      )}
    </div>
  );
}
