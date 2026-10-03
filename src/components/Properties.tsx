import {
  SlidersHorizontal,
  X,
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
import {
  deleteObject,
  updateObject,
  revertDirectText,
  revertDirectImage,
} from "../commands/document";
import { LinkTargetEditor } from "../links/LinkTargetEditor";
import { useTextLayout } from "../text/useTextLayout";
import { FontPicker } from "../fonts/FontPicker";
export function Properties({
  page,
  selected,
  hidden = false,
  onClose,
}: {
  hidden?: boolean;
  onClose?: () => void;
  page?: PageModel;
  selected: string | null;
}) {
  const o = page?.objects.find((o) => o.id === selected);
  const { layout, error: layoutError } = useTextLayout(
    o?.kind === "text" || o?.kind === "replacement" || o?.kind === "direct-text"
      ? o
      : undefined,
    false,
    o?.fontId ? documentStore.document?.fonts?.[o.fontId] : undefined,
  );
  const patch = (p: Partial<EditObject>) => {
    if (page && o) documentStore.execute(updateObject(page.id, o.id, p));
  };
  return (
    <aside
      className="properties"
      id="document-properties"
      aria-label="プロパティ"
      hidden={hidden}
    >
      <div className="side-heading">
        <strong>プロパティ</strong>
        <button
          className="panel-close"
          title="プロパティを閉じる"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {o ? (
        <div className="property-content">
          <div className="object-type">
            {o.kind === "ocr"
              ? "OCRの認識文字を校正"
              : o.kind === "direct-text"
                ? "既存テキストを直接編集"
                : o.kind === "replacement"
                  ? "既存テキストの見た目を編集"
                  : o.kind === "note"
                    ? "付箋コメント"
                    : o.kind === "redaction"
                      ? "墨消し候補"
                      : (o.kind === "image" || o.kind === "direct-image")
                        ? "画像"
                        : o.kind === "text"
                          ? "テキスト"
                          : o.kind === "rect"
                            ? "矩形"
                            : o.kind === "ellipse"
                              ? "円"
                              : o.kind === "line"
                                ? "直線"
                                : o.kind === "arrow"
                                  ? "矢印"
                                  : "オブジェクト"}
          </div>
          {o.kind === "replacement" && (
            <p className="warning small">
              元の文字情報は残ります。機密情報の削除には墨消しを使ってください。
            </p>
          )}
          {o.kind === "direct-text" && (
            <>
              <p className="hint">
                対象の元文字描画命令を置換・削除します。他の箇所や注釈の文字は残ります。機密情報の削除には墨消しを使ってください。
              </p>
              <button
                onClick={() =>
                  page && documentStore.execute(revertDirectText(page.id, o.id))
                }
              >
                元の文字に戻す
              </button>
            </>
          )}
          {o.kind === "direct-image" && <>
            <p className="hint">{o.imageDeleted ? "元の画像を削除しています。" : "既存画像の位置とサイズを編集します。同じ画像を使う別の箇所は保持します。"}</p>
            <button onClick={() => page && documentStore.execute(revertDirectImage(page.id, o.id))}>元の画像に戻す</button>
          </>}
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
          {["text", "replacement", "ocr", "direct-text"].includes(o.kind) && (
            <div className="property-group">
              <h3>テキスト</h3>
              {o.kind !== "ocr" && <label>文字の方向
                <select aria-label="文字の方向" value={o.writingMode ?? "horizontal"} onChange={e => {
                  if (e.target.value === "vertical") patch({ writingMode: "vertical", font: o.font === "custom" ? "custom" : "japanese", bold: false, italic: false, wrap: false, align: "left", width: o.fontSize, height: Math.max(o.fontSize, Array.from(o.text ?? "").length * o.fontSize) });
                  else patch({ writingMode: undefined, width: Math.max(o.fontSize, Array.from(o.text ?? "").length * o.fontSize), height: o.fontSize * 1.25 });
                }}><option value="horizontal">横書き</option><option value="vertical">縦書き（右から左へ）</option></select>
              </label>}
              {page && (
                <FontPicker
                  key={o.id}
                  object={o}
                  pageId={page.id}
                  patch={patch}
                />
              )}
              <div className="row">
                <label>
                  サイズ
                  <input
                    aria-label="フォントサイズ"
                    type="number"
                    min="1"
                    max="300"
                    value={o.fontSize}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      if (Number.isFinite(size))
                        patch({ fontSize: Math.max(1, Math.min(300, size)) });
                    }}
                  />
                </label>
                <button
                  disabled={o.writingMode === "vertical"}
                  title="太字"
                  className={o.bold ? "active" : ""}
                  onClick={() => patch({ bold: !o.bold })}
                >
                  <Bold size={16} />
                </button>
                <button
                  disabled={o.writingMode === "vertical"}
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
                  disabled={o.writingMode === "vertical"}
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
              {(o.kind === "text" ||
                o.kind === "replacement" ||
                o.kind === "direct-text") && (
                <>
                  <label className="text-wrap-control">
                    <input
                      type="checkbox"
                      checked={!!o.wrap}
                      onChange={(e) => patch({ wrap: e.target.checked })}
                    />
                    {o.writingMode === "vertical" ? "高さに合わせて折り返す" : "幅に合わせて折り返す"}
                  </label>
                  <label>
                    {o.writingMode === "vertical" ? "列間（文字サイズの倍率）" : "行間（文字サイズの倍率）"}
                    <input
                      aria-label="行間"
                      type="number"
                      min={1}
                      max={3}
                      step={0.05}
                      value={o.lineHeight ?? 1.25}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          patch({ lineHeight: Math.max(1, Math.min(3, n)) });
                      }}
                    />
                  </label>
                  {layoutError && (
                    <p className="warning small">{layoutError}</p>
                  )}
                  {layout && (
                    <>
                      <p className="hint text-layout-summary">
                        {layout.lines.length} {o.writingMode === "vertical" ? "列" : "行"}・必要な高さ{" "}
                        {Math.ceil(layout.height)} pt
                      </p>
                      {(layout.height > o.height + 0.1 ||
                        layout.width > o.width + 0.1) && (
                        <p className="warning small text-overflow-warning">
                          文字がボックスの範囲を超えています。保存時も全文を描画します。幅・高さ・文字サイズを調整してください。
                        </p>
                      )}
                      {o.writingMode === "vertical" && <button onClick={() => patch({ x: o.x + o.width - Math.ceil(layout.width), width: Math.ceil(layout.width) })}>文字に合わせて幅を調整</button>}
                      <button
                        onClick={() =>
                          patch({ height: Math.ceil(layout.height) })
                        }
                      >
                        文字に合わせて高さを調整
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {o.kind !== "link" && o.kind !== "ocr" && o.kind !== "direct-image" && (
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
              {["image", "text", "direct-text"].includes(o.kind) && (
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
          {o.kind !== "direct-image" && <div className="form-kind-buttons">
            <button
              title="オブジェクトを複製"
              onClick={() => {
                if (page) {
                  const image = o.imageId
                    ? documentStore.document?.images[o.imageId]
                    : undefined;
                  documentStore.execute(
                    pasteObject(page.id, {
                      object: o,
                      image,
                      font: o.fontId
                        ? documentStore.document?.fonts?.[o.fontId]
                        : undefined,
                    }).command,
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
          </div>}
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
