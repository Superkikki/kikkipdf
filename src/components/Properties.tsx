import {
  SlidersHorizontal,
  Trash2,
  Bold,
  Italic,
  Copy,
  ArrowUpToLine,
  ArrowDownToLine,
} from "lucide-react";
import type { EditObject, PageModel } from "../state/model";
import { documentStore } from "../state/store";
import { pasteObject, reorderObject } from "../editor/objectActions";
import { deleteObject, updateObject } from "../commands/document";
import { LinkTargetEditor } from "../links/LinkTargetEditor";
export function Properties({
  page,
  selected,
}: {
  page?: PageModel;
  selected: string | null;
}) {
  const o = page?.objects.find((o) => o.id === selected);
  const patch = (p: Partial<EditObject>) => {
    if (page && o) documentStore.execute(updateObject(page.id, o.id, p));
  };
  return (
    <aside className="properties">
      <div className="side-heading">
        <strong>プロパティ</strong>
        <SlidersHorizontal size={16} />
      </div>
      {o ? (
        <div className="property-content">
          <div className="object-type">
            {o.kind === "ocr"
              ? "OCRの認識文字を校正"
              : o.kind === "replacement"
                ? "既存テキストの見た目を編集"
                : o.kind === "note"
                  ? "付箋コメント"
                  : o.kind === "redaction"
                    ? "墨消し候補"
                    : o.kind === "image"
                      ? "画像"
                      : "オブジェクト"}
          </div>
          {o.kind === "replacement" && (
            <p className="warning small">
              元の文字情報は残ります。機密情報の削除には墨消しを使ってください。
            </p>
          )}
          {o.kind === "ocr" && (
            <p className="hint">
              透明な検索テキストを編集します。元画像や元PDFの文字は変更しません。修正後は左の一覧で確認済みにできます。
            </p>
          )}
          {o.kind === "link" && (
            <>
              <LinkTargetEditor
                target={o.link}
                pages={documentStore.document?.pages ?? []}
                onChange={(link) => patch({ link })}
              />
              <p className="hint">
                枠は編集用です。保存したPDFでは透明なリンク領域になります。
              </p>
            </>
          )}
          {o.text !== undefined && (
            <label>
              内容
              <textarea
                aria-label="テキスト内容"
                value={o.text}
                onChange={(e) => patch({ text: e.target.value })}
                rows={4}
              />
            </label>
          )}
          <div className="property-group">
            <h3>位置とサイズ</h3>
            <div className="property-grid">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key}>
                  {{ x: "X", y: "Y", width: "幅", height: "高さ" }[key]}
                  <input
                    aria-label={key}
                    type="number"
                    step="1"
                    value={Math.round(o[key] * 10) / 10}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n))
                        patch({
                          [key]:
                            key === "width" || key === "height"
                              ? Math.max(1, n)
                              : n,
                        });
                    }}
                  />
                </label>
              ))}
            </div>
            <span className="hint">単位: pt（1/72インチ）</span>
          </div>
          {o.text !== undefined && o.kind !== "note" && (
            <div className="property-group">
              <h3>テキスト</h3>
              <label>
                フォント
                <select
                  value={o.font}
                  onChange={(e) =>
                    patch({ font: e.target.value as EditObject["font"] })
                  }
                >
                  <option value="japanese">Noto Sans JP（日本語）</option>
                  <option value="sans">Helvetica</option>
                  <option value="serif">Times</option>
                  <option value="mono">Courier</option>
                </select>
              </label>
              <div className="row">
                <label>
                  サイズ
                  <input
                    aria-label="フォントサイズ"
                    type="number"
                    min="1"
                    max="300"
                    value={o.fontSize}
                    onChange={(e) =>
                      patch({ fontSize: Math.max(1, Number(e.target.value)) })
                    }
                  />
                </label>
                <button
                  title="太字"
                  className={o.bold ? "active" : ""}
                  onClick={() => patch({ bold: !o.bold })}
                >
                  <Bold size={16} />
                </button>
                <button
                  title="斜体"
                  className={o.italic ? "active" : ""}
                  onClick={() => patch({ italic: !o.italic })}
                >
                  <Italic size={16} />
                </button>
              </div>
              <label>
                文字揃え
                <select
                  value={o.align}
                  onChange={(e) =>
                    patch({ align: e.target.value as EditObject["align"] })
                  }
                >
                  <option value="left">左揃え</option>
                  <option value="center">中央揃え</option>
                  <option value="right">右揃え</option>
                </select>
              </label>
            </div>
          )}
          {o.kind !== "link" && o.kind !== "ocr" && (
            <div className="property-group">
              <h3>外観</h3>
              <label>
                文字・線の色
                <input
                  type="color"
                  value={o.color}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </label>
              <label>
                塗りつぶし
                <div className="row">
                  <input
                    type="color"
                    value={o.fill === "none" ? "#ffffff" : o.fill}
                    onChange={(e) => patch({ fill: e.target.value })}
                  />
                  <button onClick={() => patch({ fill: "none" })}>なし</button>
                </div>
              </label>
              <label>
                不透明度
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={o.opacity}
                  onChange={(e) => patch({ opacity: Number(e.target.value) })}
                />
              </label>
              <label>
                線の太さ
                <input
                  type="number"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={o.strokeWidth}
                  onChange={(e) =>
                    patch({
                      strokeWidth: Math.max(0.5, Number(e.target.value)),
                    })
                  }
                />
              </label>
              {["image", "text"].includes(o.kind) && (
                <label>
                  回転
                  <input
                    type="number"
                    step="15"
                    value={o.rotation}
                    onChange={(e) =>
                      patch({ rotation: Number(e.target.value) })
                    }
                  />
                </label>
              )}
            </div>
          )}
          <div className="form-kind-buttons">
            <button
              title="オブジェクトを複製"
              onClick={() => {
                if (page) {
                  const image = o.imageId
                    ? documentStore.document?.images[o.imageId]
                    : undefined;
                  documentStore.execute(
                    pasteObject(page.id, { object: o, image }).command,
                  );
                }
              }}
            >
              <Copy size={16} />
              複製
            </button>
            <button
              title="最前面へ"
              onClick={() =>
                page &&
                documentStore.execute(reorderObject(page.id, o.id, "front"))
              }
            >
              <ArrowUpToLine size={16} />
            </button>
            <button
              title="最背面へ"
              onClick={() =>
                page &&
                documentStore.execute(reorderObject(page.id, o.id, "back"))
              }
            >
              <ArrowDownToLine size={16} />
            </button>
          </div>
          <button
            className="danger full"
            onClick={() =>
              page && documentStore.execute(deleteObject(page.id, o.id))
            }
          >
            <Trash2 size={16} />
            削除
          </button>
        </div>
      ) : (
        <div className="property-empty">
          <div className="property-symbol">
            <SlidersHorizontal size={28} />
          </div>
          <h3>選択して、細かく調整</h3>
          <p>
            追加したテキストや図形を選択すると、位置・サイズ・色を編集できます。
          </p>
          {page && (
            <div className="page-info">
              <span>ページサイズ</span>
              <strong>
                {Math.round(page.width)} × {Math.round(page.height)} pt
              </strong>
              <span>回転</span>
              <strong>{page.rotation}°</strong>
            </div>
          )}
        </div>
      )}
      <div className="property-bottom">
        <span className="local-dot" />
        ローカル編集 · 外部送信なし
      </div>
    </aside>
  );
}
