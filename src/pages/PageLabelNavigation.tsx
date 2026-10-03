import { useEffect, useState } from "react";
import type { PageModel } from "../state/model";
import { findPageByLabel, pageLabel } from "./labels";

export function PageLabelNavigation({ pages, index, jump }: {
  pages: PageModel[];
  index: number;
  jump: (index: number) => void;
}) {
  const current = pageLabel(pages[index], index);
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(current); setError(""); }, [current, index, pages]);
  function commit() {
    if (!draft) { setDraft(current); setError(""); return; }
    const target = findPageByLabel(pages, draft, index);
    if (target < 0) {
      setDraft(current);
      setError("一致するページラベルがありません。");
      return;
    }
    setError("");
    jump(target);
  }
  if (!pages.some((page) => page.label !== undefined)) return null;
  return <div className="page-label-navigation">
    <label>ラベル
      <input aria-label="ページラベルで移動" aria-invalid={!!error}
        title={error || "ラベルを入力してEnterで移動（大文字・小文字を区別）"}
        value={draft} onChange={(e) => { setDraft(e.target.value); setError(""); }}
        onBlur={commit} onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.stopPropagation(); setDraft(current); setError(""); }
        }} />
    </label>
    {error && <span className="page-label-error" role="status">{error}</span>}
  </div>;
}
