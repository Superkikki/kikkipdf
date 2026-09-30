import { useEffect, useState } from "react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { sourcePdf } from "./pdf";
export function SearchPanel({
  model,
  jump,
}: {
  model: DocumentModel;
  jump: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<{ id: string; snippet: string }[]>([]),
    [current, setCurrent] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setResults([]);
        setCurrent(0);
        setError("");
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
              .filter((o) => ["text", "replacement", "ocr"].includes(o.kind))
              .map((o) => o.text ?? "")
              .join(" ");
            if (p.sourceId) {
              const pdf = await sourcePdf(model.sources[p.sourceId]);
              const page = await pdf.getPage(p.sourceIndex + 1);
              const content = await page.getTextContent();
              text +=
                " " +
                content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
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
    if (!results.length) return;
    const n = (current + step + results.length) % results.length;
    setCurrent(n);
    jump(results[n].id);
  }
  return (
    <div className="search-panel">
      <label className="search-input">
        <Search size={16} />
        <input
          aria-label="PDF内を検索"
          placeholder="文書内を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="search-count">
        <span>
          {busy
            ? "検索中…"
            : `${results.length ? current + 1 : 0} / ${results.length} 件`}
        </span>
        <button title="前の検索結果" onClick={() => navigate(-1)}>
          <ChevronUp size={16} />
        </button>
        <button title="次の検索結果" onClick={() => navigate(1)}>
          <ChevronDown size={16} />
        </button>
      </div>
      {error && <p className="warning">{error}</p>}
      <div className="search-results">
        {results.map((r, i) => (
          <button
            className={current === i ? "current" : ""}
            key={`${r.id}-${i}`}
            onClick={() => {
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
