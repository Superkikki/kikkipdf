import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PageNavigation({
  index,
  count,
  jump,
}: {
  index: number;
  count: number;
  jump: (index: number) => void;
}) {
  const [draft, setDraft] = useState(String(index + 1));
  useEffect(() => setDraft(String(index + 1)), [index]);
  function commit() {
    const n = Number(draft);
    if (draft.trim() && Number.isInteger(n)) {
      const page = Math.max(1, Math.min(count, n));
      setDraft(String(page));
      jump(page - 1);
    } else setDraft(String(index + 1));
  }
  return (
    <div className="page-navigation" aria-label="ページ移動">
      <button
        title="前のページ"
        disabled={index <= 0}
        onClick={() => jump(index - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <input
        aria-label="ページ番号"
        title={`1〜${count} ページを入力`}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => {
          const value = e.target.value;
          setDraft(value);
          const n = Number(value);
          if (value.trim() && Number.isInteger(n) && n >= 1 && n <= count)
            jump(n - 1);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(String(index + 1));
          }
        }}
      />
      <span>/ {count}</span>
      <button
        title="次のページ"
        disabled={index >= count - 1}
        onClick={() => jump(index + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
