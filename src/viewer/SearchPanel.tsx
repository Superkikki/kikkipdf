import { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { acquirePagePdf } from "./pdf";
export function SearchPanel({
  model,
  jump,
  focusRequest = 0,
}: {
  focusRequest?: number;
  model: DocumentModel;
  jump: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<{ id: string; snippet: string }[]>([]),
    [current, setCurrent] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const visited = useRef<number | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);
  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setCurrent(0);
    setError("");
    setBusy(!!query.trim());
    visited.current = null;
    const timer = setTimeout(() => {
      void (async () => {
        if (!query.trim()) {
          setBusy(false);
          return;
        }
        setBusy(true);
        const found: { id: string; snippet: string }[] = [];
        try {
          for (const p of model.pages) {
            if (cancelled) return;
            let text = p.objects
              .filter((o) =>
                ["text", "replacement", "ocr", "direct-text"].includes(o.kind),
              )
              .map((o) => o.text ?? "")
              .join(" ");
            if (p.sourceId) {
              const lease = acquirePagePdf(model.sources[p.sourceId], p);
              try {
                const { pdf, index } = await lease.ready;
                const page = await pdf.getPage(index + 1);
                const content = await page.getTextContent();
                text +=
                  " " +
                  content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
              } finally {
                lease.release();
              }
            }
            const lower = text.toLocaleLowerCase(),
              q = query.toLocaleLowerCase();
            let index = lower.indexOf(q);
            while (index !== -1) {
              found.push({
                id: p.id,
                snippet: text.slice(
                  Math.max(0, index - 22),
                  index + q.length + 40,
                ),
              });
              index = lower.indexOf(q, index + q.length);
            }
            await new Promise((r) => setTimeout(r, 0));
          }
          if (!cancelled) setResults(found);
        } catch {
          if (!cancelled) setError("このPDFのテキストを検索できませんでした。");
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, model]);
  function navigate(step: number) {
    if (busy || !results.length) return;
    const n =
      visited.current === null
        ? step > 0 ? current : results.length - 1
        : (current + step + results.length) % results.length;
    visited.current = n;
    setCurrent(n);
    jump(results[n].id);
  }
  return (
    <div className="search-panel">
      <label className="search-input">
        <Search size={16} />
        <input
          ref={input}
          aria-label="PDF内を検索"
          placeholder="文書内を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              navigate(e.shiftKey ? -1 : 1);
            }
          }}
        />
      </label>
      <div className="search-count">
        <span role="status" aria-live="polite">
          {busy
            ? "検索中…"
            : `${results.length ? current + 1 : 0} / ${results.length} 件`}
        </span>
        <button
          title="前の検索結果"
          disabled={busy || !results.length}
          onClick={() => navigate(-1)}
        >
          <ChevronUp size={16} />
        </button>
        <button
          title="次の検索結果"
          disabled={busy || !results.length}
          onClick={() => navigate(1)}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <p className="hint">Enterで次の結果 · Shift+Enterで前の結果</p>
      {!busy && !error && query.trim() && !results.length && (
        <p className="empty-panel">一致するテキストがありません。</p>
      )}
      {error && <p className="warning">{error}</p>}
      <div className="search-results">
        {results.map((r, i) => (
          <button
            className={current === i ? "current" : ""}
            key={`${r.id}-${i}`}
            onClick={() => {
              visited.current = i;
              setCurrent(i);
              jump(r.id);
            }}
          >
            <small>
              ページ {model.pages.findIndex((p) => p.id === r.id) + 1}
            </small>
            {r.snippet}
          </button>
        ))}
      </div>
    </div>
  );
}
