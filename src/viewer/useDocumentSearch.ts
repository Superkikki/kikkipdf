import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { parseRange } from "../pages/ranges";
import { acquirePagePdf } from "./pdf";
import { directReferences, directImageEdits } from "../direct/model";
import { defaultSearchOptions, findTextMatches, SEARCH_RESULT_LIMIT,
  type SearchHit, type SearchOptions, type SearchPart } from "./search";
const noHits: SearchHit[] = [];
const TEXT_CACHE_LIMIT = 4_000_000;

export function useDocumentSearch(model: DocumentModel | null, jump: (id: string) => void) {
  const [query, setQuery] = useState("");
  const [pageRange, setPageRange] = useState("");
  const [options, setOptions] = useState(defaultSearchOptions);
  const [result, setResult] = useState<{ model: DocumentModel | null; query: string; options: SearchOptions; pageRange: string; hits: SearchHit[]; limited: boolean }>({ model: null, query: "", options: defaultSearchOptions, pageRange: "", hits: [], limited: false });
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [navigation, setNavigation] = useState<{ hitId: string; request: number } | null>(null);
  const visited = useRef(false), sequence = useRef(0);
  const cache = useRef({ entries: new Map<string, SearchPart[]>(), size: 0 });
  useEffect(() => {
    setQuery("");
    setPageRange("");
    setNavigation(null);
    cache.current = { entries: new Map(), size: 0 };
  }, [model?.id]);
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    setResult({ model, query, options, pageRange, hits: [], limited: false });
    setCurrent(0);
    setNavigation(null);
    setError("");
    setProgress(0);
    visited.current = false;
    setBusy(!!model && !!query.trim());
    if (!model || !query.trim()) return;
    let selected: number[];
    try { selected = parseRange(pageRange, model.pages.length).sort((a, b) => a - b); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ページ範囲が不正です。"); setBusy(false); return; }
    const timer = setTimeout(() => {
      void (async () => {
        const hits: SearchHit[] = [];
        try {
          for (const [searched, pageIndex] of selected.entries()) {
            const page = model.pages[pageIndex];
            if (cancelled) return;
            const key = `${page.sourceId}:${page.sourceIndex}:${JSON.stringify({
              text: directReferences(page), images: directImageEdits(page),
            })}`;
            let parts = cache.current.entries.get(key);
            if (parts) {
              cache.current.entries.delete(key);
              cache.current.entries.set(key, parts);
            }
            if (!parts) {
              parts = [];
              if (page.sourceId) {
                const lease = acquirePagePdf(model.sources[page.sourceId], page, model.images);
                release = lease.release;
                try {
                  const { pdf, index } = await lease.ready;
                  if (cancelled) return;
                  const sourcePage = await pdf.getPage(index + 1);
                  const content = await sourcePage.getTextContent();
                  parts = content.items.filter((item) => "str" in item)
                    .map((item, i) => ({ key: `source:${i}`, text: item.str, hasEOL: item.hasEOL }));
                } finally { lease.release(); release = undefined; }
              }
              if (cancelled) return;
              const size = parts.reduce((total, part) => total + part.text.length, 0);
              if (size <= TEXT_CACHE_LIMIT) {
                for (const [oldKey, oldParts] of cache.current.entries) {
                  if (cache.current.size + size <= TEXT_CACHE_LIMIT) break;
                  cache.current.entries.delete(oldKey);
                  cache.current.size -= oldParts.reduce((total, part) => total + part.text.length, 0);
                }
                cache.current.entries.set(key, parts);
                cache.current.size += size;
              }
            }
            const groups = [parts, ...page.objects
              .filter((o) => ["text", "replacement", "ocr", "direct-text"].includes(o.kind) && o.text)
              .map((o) => [{ key: `object:${o.id}`, text: o.text! }])];
            for (const group of groups) {
              const matches = findTextMatches(group, query, options, SEARCH_RESULT_LIMIT + 1 - hits.length);
              for (const match of matches) hits.push({ ...match, pageId: page.id, pageNumber: pageIndex + 1,
                id: `${page.id}:${group[0]?.key}:${match.start}` });
              if (hits.length > SEARCH_RESULT_LIMIT) break;
            }
            if (hits.length > SEARCH_RESULT_LIMIT) break;
            if (!cancelled) setProgress(searched + 1);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (!cancelled) setResult({ model, query, options, pageRange, hits: hits.slice(0, SEARCH_RESULT_LIMIT), limited: hits.length > SEARCH_RESULT_LIMIT });
        } catch {
          if (!cancelled) setError("このPDFのテキストを検索できませんでした。");
        } finally { if (!cancelled) setBusy(false); }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); release?.(); };
  }, [query, options, pageRange, model]);
  const ready = result.model === model && result.query === query && result.options === options && result.pageRange === pageRange;
  const hits = ready ? result.hits : noHits;
  let pageCount = model?.pages.length ?? 0;
  try { pageCount = parseRange(pageRange, pageCount).length; } catch { pageCount = 0; }
  const byPage = useMemo(() => {
    const pages = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const group = pages.get(hit.pageId) ?? [];
      group.push(hit);
      pages.set(hit.pageId, group);
    }
    return pages;
  }, [hits]);
  function select(index: number) {
    if (busy || !hits[index]) return;
    visited.current = true;
    setCurrent(index);
    jump(hits[index].pageId);
    setNavigation({ hitId: hits[index].id, request: ++sequence.current });
  }
  const completeNavigation = useCallback((request: number) => {
    setNavigation((pending) => pending?.request === request ? null : pending);
  }, []);
  return { query, setQuery, pageRange, setPageRange, pageCount, documentName: model?.name ?? "document.pdf", options, setOptions: (value: SearchOptions) => setOptions(value), hits,
    busy, progress, error, current, limited: ready && result.limited, byPage, navigation, completeNavigation,
    currentId: hits[current]?.id,
    select, navigate: (step: number) => select(visited.current
      ? (current + step + hits.length) % hits.length : step > 0 ? current : hits.length - 1) };
}
export type DocumentSearch = ReturnType<typeof useDocumentSearch>;
