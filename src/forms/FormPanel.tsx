import { useState } from "react";
import type { DocumentModel, FieldValue } from "../state/model";
import { useImportedForms } from "./useImportedForms";
import { ImportedFormDesigner } from "./ImportedFormDesigner";
import { documentStore } from "../state/store";
import { FormDesigner } from "./FormDesigner";
import { updateFormField } from "./commands";
import { change } from "../commands/document";
import { resolveImportedForm } from "./importedSettings";
import { dataFields, applyFormData, restoreFormData } from "./data";
import { formDataXfdf, parseFormDataXfdf } from "./xfdf";
import { pickFiles, saveBytes } from "../platform/files";
import { flushInlineText } from "../editor/flushInlineText";
export function FormPanel({
  model,
  active,
}: {
  model: DocumentModel;
  active: string;
}) {
  const { fields, error, loading } = useImportedForms(model.sources);
  const [tab, setTab] = useState("fill");
  const [busy, setBusy] = useState(false);
  const [dataError, setDataError] = useState("");
  const [status, setStatus] = useState("");
  async function transfer(importing: boolean) {
    if (!flushInlineText()) return;
    setBusy(true); setDataError(""); setStatus("");
    try {
      const file = importing ? (await pickFiles("xfdf"))[0] : undefined;
      if (importing && !file) return;
      if (!flushInlineText()) return;
      const snapshot = documentStore.document;
      if (!snapshot || snapshot.id !== model.id || snapshot.sources !== model.sources) throw Error("文書が切り替わりました。再度実行してください。");
      if (file) {
        const entries = parseFormDataXfdf(file.bytes);
        documentStore.execute(applyFormData(fields, entries));
        setStatus(`${entries.length}項目を読み込みました。Undoで戻せます。`);
      } else {
        const bytes = formDataXfdf(dataFields(snapshot, fields));
        await saveBytes(bytes, `${snapshot.name.replace(/\.(pdf|kpdf)$/i, "")}-フォーム値.xfdf`);
        setStatus("フォーム値を保存しました。");
      }
    } catch (reason) { setDataError(reason instanceof Error ? reason.message : "フォーム値を処理できませんでした。"); }
    finally { setBusy(false); }
  }
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
        <>
          {loading && <p>フォームを読み込み中…</p>}
          {error && <p className="warning">{error}</p>}
          <ImportedFormDesigner model={model} fields={fields} active={active} />
          <FormDesigner model={model} active={active} />
        </>
      ) : (
        <>
          <p className="notice">
            標準AcroFormを保持して保存します。入力欄の外観は保存後に更新されます。同名フィールドの結合時は名前に連番が付きます。XFA・計算スクリプトは未対応です。
          </p>
          <div className="form-kind-buttons">
            <button disabled={busy || loading || !!error || !dataFields(model, fields).length} onClick={() => void transfer(false)}>フォーム値をXFDF保存</button>
            <button disabled={busy || loading || !!error || !dataFields(model, fields).length} onClick={() => void transfer(true)}>フォーム値をXFDF読み込み</button>
            <button disabled={busy || loading || !!error || !dataFields(model, fields).length} onClick={() => {
              setDataError(""); setStatus("");
              try { documentStore.execute(restoreFormData(fields)); }
              catch (reason) { setDataError(reason instanceof Error ? reason.message : "フォーム値を戻せませんでした。"); }
            }}>入力値を読み込み時に戻す</button>
          </div>
          <p className="hint">XFDFはフォーム名と保存値をやり取りします。注釈はコメントパネルで扱います。値を戻す操作は設定と配置を保持し、追加した欄は空にします。読み取り専用欄は変更しません。</p>
          {dataError && <p role="alert" className="warning">{dataError}</p>}
          {status && <p role="status">{status}</p>}
          {loading && <p>フォームを読み込み中…</p>}
          {error && <p className="warning">{error}</p>}
          {!loading &&
            !fields.length &&
            !model.formFields?.length &&
            !error && (
              <p>このPDFには対応するフォームフィールドがありません。</p>
            )}
          {[
            ...fields
              .map((f) => resolveImportedForm(f, model))
              .filter((f) =>
                f.widgets.some((w) =>
                  model.pages.some(
                    (p) =>
                      p.sourceId === f.sourceId &&
                      p.sourceIndex === w.pageIndex,
                  ),
                ),
              ),
            ...(model.formFields ?? []).map((f) => ({
              ...f,
              key: "new:" + f.id,
            })),
          ].map((f) => {
            const value = f.value;
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
                    {(
                      f.choiceOptions ??
                      f.options.map((value) => ({ value, label: value }))
                    ).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
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
