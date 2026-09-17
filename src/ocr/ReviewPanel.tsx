import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import { clearOcr, ocrRows, reviewOcr } from "./review";
export function ReviewPanel({
  model,
  active,
  selected,
  select,
}: {
  model: DocumentModel;
  active: string;
  selected: string | null;
  select: (pageId: string, id: string) => void;
}) {
  const [scope, setScope] = useState("page"),
    [onlyPending, setOnlyPending] = useState(false),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const rows = useMemo(
    () => ocrRows(model, scope === "page" ? active : undefined),
    [model, active, scope],
  );
  const filtered = rows.filter(
    (r) =>
      (!onlyPending || !r.object.ocrReviewed) &&
      (r.object.text ?? "")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const start = Math.min(
    offset,
    Math.max(0, Math.floor((filtered.length - 1) / 100) * 100),
  );
  const current = rows.find((r) => r.object.id === selected);
  return (
    <div className="ocr-review-panel">
      <label>
        対象
        <select
          aria-label="OCR校正の対象"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setOffset(0);
          }}
        >
          <option value="page">現在のページ</option>
          <option value="all">全ページ</option>
        </select>
      </label>
      <label>
        認識結果を絞り込む
        <input
          aria-label="認識結果を絞り込む"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <label className="ocr-pending">
        <input
          type="checkbox"
          checked={onlyPending}
          onChange={(e) => {
            setOnlyPending(e.target.checked);
            setOffset(0);
          }}
        />
        未確認のみ
      </label>
      <p className="ocr-summary">
        {rows.filter((r) => r.object.ocrReviewed).length} / {rows.length} 行
        確認済み
      </p>
      <div className="ocr-row-list">
        {filtered.slice(start, start + 100).map((r) => (
          <button
            className={`ocr-row ${selected === r.object.id ? "active" : ""}`}
            key={`${r.pageId}:${r.object.id}`}
            onClick={() => select(r.pageId, r.object.id)}
          >
            <span>
              <small>ページ {r.pageNumber}</small>
              {r.object.ocrReviewed ? (
                <Check size={14} aria-label="確認済み" />
              ) : (
                <small
                  className={
                    (r.object.ocrConfidence ?? 100) < 80 ? "warning" : ""
                  }
                >
                  信頼度{" "}
                  {r.object.ocrConfidence === undefined
                    ? "不明"
                    : Math.round(r.object.ocrConfidence)}
                </small>
              )}
            </span>
            <strong>{r.object.text}</strong>
          </button>
        ))}
      </div>
      {filtered.length > 100 && (
        <div className="ocr-pagination">
          <button
            aria-label="前のOCR結果"
            disabled={!start}
            onClick={() => setOffset(start - 100)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {start + 1}–{Math.min(start + 100, filtered.length)} /{" "}
            {filtered.length}
          </span>
          <button
            aria-label="次のOCR結果"
            disabled={start + 100 >= filtered.length}
            onClick={() => setOffset(start + 100)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      {current && (
        <button
          onClick={() =>
            documentStore.execute(
              reviewOcr([current], !current.object.ocrReviewed),
            )
          }
        >
          {current.object.ocrReviewed ? "未確認に戻す" : "確認済みにする"}
        </button>
      )}
      {!!rows.length && (
        <button
          className="danger"
          onClick={() =>
            documentStore.execute(
              clearOcr(
                scope === "page" ? [active] : model.pages.map((p) => p.id),
              ),
            )
          }
        >
          対象ページのOCRを削除
        </button>
      )}
      <p className="empty-panel">
        行を選ぶと元画像の位置を表示します。右パネルで認識文字と位置を修正できます。信頼度はエンジンの推定値です。画像自体は変わりません。
      </p>
      {!rows.length && (
        <p className="empty-panel">
          このアプリで実行したOCR結果が対象です。「ツール」→「OCR」で認識してから校正してください。
        </p>
      )}
    </div>
  );
}
