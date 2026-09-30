import { useState } from "react";
import type { DocumentModel } from "../state/model";
import type { FormDescriptor } from "../export/engine";
import { pageSize } from "../state/model";
import { documentStore } from "../state/store";
import { PageView } from "../viewer/PageView";
import { resetFormWidget, updateFormWidget } from "./commands";

export function ImportedFormDesigner({
  model,
  fields,
  active,
}: {
  model: DocumentModel;
  fields: FormDescriptor[];
  active: string;
}) {
  const [selected, setSelected] = useState("");
  const widgets = model.pages.flatMap((page, index) =>
    fields
      .filter((f) => f.sourceId === page.sourceId)
      .flatMap((field) =>
        field.widgets
          .filter((w) => w.pageIndex === page.sourceIndex)
          .map((widget) => ({
            key: JSON.stringify([page.id, widget.id]),
            page,
            index,
            field,
            widget,
          })),
      ),
  );
  const entry = widgets.find((w) => w.key === selected);
  const page =
    entry?.page ?? model.pages.find((p) => p.id === active) ?? model.pages[0];
  const box = entry
    ? (entry.page.formWidgetEdits?.[entry.widget.id] ?? entry.widget)
    : undefined;
  const size = pageSize(page);
  return (
    <section
      className="imported-form-designer"
      aria-label="既存フォームの配置編集"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (
          !(e.ctrlKey || e.metaKey) ||
          (e.target as HTMLElement).closest("input,textarea,select")
        )
          return;
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          e.stopPropagation();
          if (key === "y" || e.shiftKey) documentStore.redo();
          else documentStore.undo();
        }
      }}
    >
      <h3>既存フォームの配置</h3>
      <div className="form-kind-buttons">
        <button
          disabled={!documentStore.history?.canUndo}
          onClick={() => documentStore.undo()}
        >
          配置編集を元に戻す
        </button>
        <button
          disabled={!documentStore.history?.canRedo}
          onClick={() => documentStore.redo()}
        >
          配置編集をやり直す
        </button>
      </div>
      <p className="notice">
        入力欄を選び、プレビューで移動・右下のハンドルでサイズ変更できます。座標は回転前のページ左上からのptです。同じ項目の値は共有し、配置は各欄ごとに変更します。
      </p>
      {!widgets.length ? (
        <p>この文書に配置できる既存フォームはありません。</p>
      ) : (
        <>
          <label>
            既存の入力欄
            <select
              aria-label="既存の入力欄"
              value={entry?.key ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">選択してください</option>
              {widgets.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.field.name} — ページ{w.index + 1}
                  {w.widget.option ? ` / ${w.widget.option}` : ""}
                </option>
              ))}
            </select>
          </label>
          {entry && box && (
            <>
              <div className="property-grid">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key}>
                    {{ x: "X", y: "Y", width: "幅", height: "高さ" }[key]}
                    <input
                      aria-label={`既存フィールド${key}`}
                      type="number"
                      step="0.5"
                      value={box[key]}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          documentStore.execute(
                            updateFormWidget(entry.page.id, entry.widget.id, {
                              x: box.x,
                              y: box.y,
                              width: box.width,
                              height: box.height,
                              [key]: Math.max(
                                key === "x" || key === "y" ? 0 : 1,
                                Math.min(100000, n),
                              ),
                            }),
                          );
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                disabled={!entry.page.formWidgetEdits?.[entry.widget.id]}
                onClick={(e) => {
                  documentStore.execute(
                    resetFormWidget(entry.page.id, entry.widget.id),
                  );
                  e.currentTarget.closest<HTMLElement>("section")?.focus();
                }}
              >
                元の配置に戻す
              </button>
              {(box.x + box.width > page.width ||
                box.y + box.height > page.height) && (
                <p className="warning">
                  入力欄がページ外へはみ出しています。位置とサイズを調整してください。
                </p>
              )}
            </>
          )}
          <div className="form-layout-preview">
            <PageView
              model={model}
              page={page}
              scale={Math.min(420 / size.width, 320 / size.height)}
              formEdit={{
                widgetId: entry?.widget.id ?? "",
                select: (id) => setSelected(JSON.stringify([page.id, id])),
              }}
            />
          </div>
          <p className="hint">
            ページ{model.pages.indexOf(page) + 1}
            の配置プレビュー。欄の外観は保存時に再生成します。Undo/RedoはCtrl+Z
            / Ctrl+Yです。
          </p>
        </>
      )}
    </section>
  );
}
