import { Minus, Plus } from "lucide-react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  stepZoom,
  type ZoomMode,
} from "../viewer/zoom";

export function ZoomControls({
  zoom,
  scale,
  onChange,
}: {
  zoom: ZoomMode;
  scale: number;
  onChange: (zoom: ZoomMode) => void;
}) {
  return (
    <div className="zoom-controls">
      <button
        title="縮小"
        disabled={scale <= MIN_ZOOM}
        onClick={() => onChange(stepZoom(scale, -1))}
      >
        <Minus size={15} />
      </button>
      <select
        aria-label="ズーム"
        value={String(zoom)}
        onChange={(e) =>
          onChange(
            e.target.value === "width" || e.target.value === "page"
              ? e.target.value
              : Number(e.target.value),
          )
        }
      >
        <option value="width">ページ幅に合わせる</option>
        <option value="page">ページ全体を表示</option>
        {typeof zoom === "number" && !ZOOM_PRESETS.includes(zoom) && (
          <option value={zoom}>{Math.round(zoom * 100)}%</option>
        )}
        {ZOOM_PRESETS.map((n) => (
          <option value={n} key={n}>{n * 100}%</option>
        ))}
      </select>
      <output className="zoom-value" aria-label="表示倍率">
        {Math.round(scale * 100)}%
      </output>
      <button
        title="拡大"
        disabled={scale >= MAX_ZOOM}
        onClick={() => onChange(stepZoom(scale, 1))}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
