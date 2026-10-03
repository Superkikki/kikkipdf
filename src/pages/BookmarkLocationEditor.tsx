import type { BookmarkDestination, BookmarkModel } from "../state/model";
import { documentStore } from "../state/store";
import { updateBookmark } from "./bookmarks";

export function BookmarkLocationEditor({ bookmark }: { bookmark: BookmarkModel }) {
  const d = bookmark.destination ?? { kind: "Fit" };
  function update(destination: BookmarkDestination) {
    documentStore.execute(updateBookmark(bookmark.id, { destination }));
  }
  function choose(kind: string) {
    switch (kind) {
      case "XYZ": update({ kind, left: null, top: null, zoom: null }); break;
      case "FitH": case "FitBH": update({ kind, top: null }); break;
      case "FitV": case "FitBV": update({ kind, left: null }); break;
      case "FitR": update({ kind, left: 0, bottom: 0, right: 100, top: 100 }); break;
      case "Fit": case "FitB": update({ kind }); break;
    }
  }
  function field(key: "left" | "top" | "right" | "bottom", title: string) {
    if (!(key in d)) return null;
    const value = (d as unknown as Record<string, number | null>)[key];
    return <label key={key}>
      {title}
      <input type="number" step="0.5" min={-1e6} max={1e6}
        aria-label={`しおりの${title}`} value={value ?? ""} placeholder="指定なし"
        onChange={(e) => {
          const n = e.target.value === "" ? null : Number(e.target.value);
          if (n !== null && (!Number.isFinite(n) || Math.abs(n) > 1e6)) return;
          if (d.kind === "FitR") {
            if (n === null) return;
            const next = { ...d, [key]: n };
            if (next.right <= next.left || next.top <= next.bottom) return;
            update(next);
          } else update({ ...d, [key]: n });
        }} />
    </label>;
  }
  return <div className="bookmark-location-editor">
    <label>
      表示方法
      <select aria-label="しおりの表示方法" value={d.kind} onChange={(e) => choose(e.target.value)}>
        <option value="Fit">ページ全体</option>
        <option value="XYZ">位置・倍率を指定</option>
        <option value="FitH">幅に合わせる</option>
        <option value="FitV">高さに合わせる</option>
        <option value="FitR">範囲に合わせる</option>
        <option value="FitB">描画領域全体</option>
        <option value="FitBH">描画領域の幅</option>
        <option value="FitBV">描画領域の高さ</option>
      </select>
    </label>
    <div className="property-grid">
      {field("left", "左位置")}
      {field("top", "上位置")}
      {field("right", "右位置")}
      {field("bottom", "下位置")}
      {d.kind === "XYZ" && <label>
        倍率（%）
        <input type="number" min="0" max="10000" step="25" aria-label="しおりの倍率（%）"
          value={d.zoom === null ? "" : Number((d.zoom * 100).toFixed(4))}
          placeholder="現在の倍率"
          onChange={(e) => {
            const zoom = e.target.value === "" ? null : Number(e.target.value) / 100;
            if (zoom !== null && (!Number.isFinite(zoom) || zoom < 0 || zoom > 100)) return;
            update({ ...d, zoom });
          }} />
      </label>}
    </div>
    {!["Fit", "FitB"].includes(d.kind) &&
      <p className="notice">位置はPDFの座標（pt、左下が原点）です。空欄は位置を指定しません。倍率の0・空欄は現在の倍率を使います。</p>}
  </div>;
}
