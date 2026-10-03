import { useEffect, useRef, useState } from "react";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import type { DocumentSearch } from "./useDocumentSearch";
import { SEARCH_PAGE_SIZE, SEARCH_RESULT_LIMIT } from "./search";

export function SearchPanel({ search, count, focusRequest = 0 }: {
  search: DocumentSearch;
  count: number;
  focusRequest?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [listPage, setListPage] = useState(0);
  const { query, options, hits, current, busy } = search;
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  useEffect(() => setListPage(Math.floor(current / SEARCH_PAGE_SIZE)), [current, hits]);
  const pages = Math.ceil(hits.length / SEARCH_PAGE_SIZE);
  return <div className="search-panel">
    <label className="search-input">
      <Search size={16} />
      <input ref={input} aria-label="PDF内を検索" placeholder="文書内を検索"
        value={query} onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault(); search.navigate(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault(); e.stopPropagation(); search.setQuery("");
          }
        }} />
      {query && <button type="button" aria-label="検索をクリア" title="検索をクリア"
        onClick={() => { search.setQuery(""); input.current?.focus(); }}><X size={14} /></button>}
    </label>
    <div className="search-options">
      <label><input type="checkbox" checked={options.caseSensitive}
        onChange={(e) => search.setOptions({ ...options, caseSensitive: e.target.checked })} />大文字と小文字を区別</label>
      <label><input type="checkbox" checked={options.wholeWord}
        onChange={(e) => search.setOptions({ ...options, wholeWord: e.target.checked })} />単語全体に一致</label>
      <label><input type="checkbox" checked={options.normalizeWidth}
        onChange={(e) => search.setOptions({ ...options, normalizeWidth: e.target.checked })} />全角と半角を同一視</label>
    </div>
    <div className="search-count">
      <span role="status" aria-live="polite">{busy ? `検索中… ${search.progress} / ${count} ページ`
        : `${hits.length ? current + 1 : 0} / ${hits.length} 件`}</span>
      <button title="前の検索結果" disabled={busy || !hits.length} onClick={() => search.navigate(-1)}><ChevronUp size={16} /></button>
      <button title="次の検索結果" disabled={busy || !hits.length} onClick={() => search.navigate(1)}><ChevronDown size={16} /></button>
    </div>
    <p className="hint">Enterで次の結果 · Shift+Enterで前の結果</p>
    {!busy && !search.error && query.trim() && !hits.length && <p className="empty-panel">一致するテキストがありません。</p>}
    {search.error && <p className="warning">{search.error}</p>}
    {search.limited && <p className="hint">先頭{SEARCH_RESULT_LIMIT}件を表示しています。検索語を絞り込んでください。</p>}
    {pages > 1 && <div className="search-pagination" aria-label="検索結果の一覧ページ">
      <button disabled={listPage === 0} onClick={() => setListPage(listPage - 1)}>前の100件</button>
      <span>{listPage + 1} / {pages}</span>
      <button disabled={listPage >= pages - 1} onClick={() => setListPage(listPage + 1)}>次の100件</button>
    </div>}
    <div className="search-results">
      {hits.slice(listPage * SEARCH_PAGE_SIZE, (listPage + 1) * SEARCH_PAGE_SIZE).map((hit, i) => {
        const index = listPage * SEARCH_PAGE_SIZE + i;
        return <button className={current === index ? "current" : ""} key={hit.id}
          aria-current={current === index ? "true" : undefined} onClick={() => search.select(index)}>
          <small>ページ {hit.pageNumber}</small>
          {hit.before}<mark>{hit.match}</mark>{hit.after}
        </button>;
      })}
    </div>
  </div>;
}
