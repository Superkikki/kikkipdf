import { useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  IndentIncrease,
  IndentDecrease,
  ExternalLink,
} from "lucide-react";
import { validatedLinkUrl } from "../links/target";
import { uid, type BookmarkModel, type DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import {
  addBookmark,
  updateBookmark,
  removeBookmark,
  moveBookmark,
  locateBookmark,
  filterBookmarks,
  setBookmarksExpanded,
} from "./bookmarks";
export function BookmarkPanel({
  model,
  active,
  jump,
}: {
  model: DocumentModel;
  active: string;
  jump: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const nodes = model.bookmarks ?? [],
    found = locateBookmark(nodes, selected);
  const filtered = filterBookmarks(nodes, query);
  let urlError = "";
  if (found?.node.url !== undefined) {
    try {
      validatedLinkUrl(found.node.url);
    } catch (e) {
      urlError = e instanceof Error ? e.message : "URLが不正です。";
    }
  }
  function add() {
    const b = {
      id: uid(),
      title: `ページ ${model.pages.findIndex((p) => p.id === active) + 1}`,
      pageId: active,
      children: [],
    };
    documentStore.execute(addBookmark(b));
    setSelected(b.id);
  }
  function render(items: BookmarkModel[], depth = 0): React.ReactNode {
    return items.map((b) => (
      <div key={b.id}>
        <div className="bookmark-row" style={{ paddingLeft: depth * 14 }}>
          {b.children.length > 0 ? (
            <button
              className="bookmark-toggle"
              aria-label={`${b.expanded === false && !query.trim() ? "展開" : "折りたたむ"}：${b.title}`}
              aria-expanded={query.trim() ? true : b.expanded !== false}
              disabled={!!query.trim()}
              onClick={() =>
                documentStore.execute(
                  updateBookmark(b.id, { expanded: b.expanded === false }),
                )
              }
            >
              {b.expanded === false && !query.trim() ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          ) : (
            <span className="bookmark-toggle-spacer" />
          )}
          <button
            className={`side-item ${b.id === selected ? "active" : ""}`}
            style={{ paddingLeft: 12 }}
            onClick={() => {
              setSelected(b.id);
              if (b.pageId && model.pages.some((p) => p.id === b.pageId))
                jump(b.pageId);
            }}
          >
            {b.url !== undefined ? <ExternalLink size={14} /> : <Bookmark size={14} />}
            <span style={{
              color: b.color,
              fontWeight: b.bold ? 700 : undefined,
              fontStyle: b.italic ? "italic" : undefined,
            }}>{b.title}</span>
          </button>
        </div>
        {(query.trim() || b.expanded !== false) &&
          render(b.children, depth + 1)}
      </div>
    ));
  }
  return (
    <div className="bookmark-panel">
      <button className="full" onClick={add}>
        <Plus size={15} />
        現在のページにしおり
      </button>
      <label className="bookmark-search">
        しおりを検索
        <input
          aria-label="しおりを検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前で絞り込み"
        />
      </label>
      <div className="form-kind-buttons">
        <button
          disabled={!nodes.some((b) => b.children.length) || !!query.trim()}
          onClick={() => documentStore.execute(setBookmarksExpanded(true))}
        >
          すべて展開
        </button>
        <button
          disabled={!nodes.some((b) => b.children.length) || !!query.trim()}
          onClick={() => documentStore.execute(setBookmarksExpanded(false))}
        >
          すべて折りたたむ
        </button>
      </div>
      {render(filtered)}
      {nodes.length > 0 && query.trim() && !filtered.length && (
        <p className="empty-panel">一致するしおりはありません。</p>
      )}
      {!nodes.length && <p className="empty-panel">しおりはありません。</p>}
      {found && (
        <div className="bookmark-editor">
          <label>
            しおりの名前
            <input
              aria-label="しおりの名前"
              value={found.node.title}
              onChange={(e) =>
                documentStore.execute(
                  updateBookmark(selected, { title: e.target.value }),
                )
              }
            />
          </label>
          <label>
            文字色
            <input
              type="color"
              aria-label="しおりの文字色"
              value={found.node.color ?? "#000000"}
              onChange={(e) => documentStore.execute(
                updateBookmark(selected, { color: e.target.value }),
              )}
            />
          </label>
          <div className="bookmark-style-controls">
            <label>
              <input type="checkbox" aria-label="しおりの太字"
                checked={!!found.node.bold}
                onChange={(e) => documentStore.execute(
                  updateBookmark(selected, { bold: e.target.checked }),
                )} />太字
            </label>
            <label>
              <input type="checkbox" aria-label="しおりの斜体"
                checked={!!found.node.italic}
                onChange={(e) => documentStore.execute(
                  updateBookmark(selected, { italic: e.target.checked }),
                )} />斜体
            </label>
          </div>
          <button className="full"
            disabled={found.node.color === undefined && !found.node.bold && !found.node.italic}
            onClick={() => documentStore.execute(
            updateBookmark(selected, { color: undefined, bold: undefined, italic: undefined }),
          )}>書式を標準に戻す</button>
          <label>
            移動先
            <select
              aria-label="しおりの移動先"
              value={found.node.url !== undefined ? "url" : found.node.pageId ?? ""}
              onChange={(e) =>
                documentStore.execute(
                  updateBookmark(selected, e.target.value === "url"
                    ? { url: "https://" }
                    : { pageId: e.target.value || undefined }),
                )
              }
            >
              <option value="">見出しのみ</option>
              <option value="url">Web / メール</option>
              {model.pages.map((p, i) => (
                <option key={p.id} value={p.id}>
                  ページ {i + 1}
                </option>
              ))}
            </select>
          </label>
          {found.node.url !== undefined && (
            <>
              <label>
                しおりURL
                <input
                  aria-label="しおりURL"
                  aria-invalid={!!urlError}
                  value={found.node.url}
                  placeholder="https://… / mailto:…"
                  onChange={(e) => documentStore.execute(
                    updateBookmark(selected, { url: e.target.value }),
                  )}
                />
              </label>
              {urlError && <p role="alert">{urlError}</p>}
              <p className="notice">外部URLはPDFに保存します。この画面では移動先を編集できます。</p>
            </>
          )}
          <div className="form-kind-buttons">
            <button
              title="しおりを上へ"
              disabled={!found.index}
              onClick={() =>
                documentStore.execute(
                  moveBookmark(selected, found.parentId, found.index - 1),
                )
              }
            >
              <ArrowUp size={14} />
            </button>
            <button
              title="しおりを下へ"
              disabled={found.index === found.siblings.length - 1}
              onClick={() =>
                documentStore.execute(
                  moveBookmark(selected, found.parentId, found.index + 1),
                )
              }
            >
              <ArrowDown size={14} />
            </button>
            <button
              title="しおりを階層の内側へ"
              disabled={!found.index}
              onClick={() => {
                const prev = found.siblings[found.index - 1];
                documentStore.execute(
                  moveBookmark(selected, prev.id, prev.children.length),
                );
              }}
            >
              <IndentIncrease size={14} />
            </button>
            <button
              title="しおりを階層の外側へ"
              disabled={!found.parentId}
              onClick={() => {
                const parent = locateBookmark(nodes, found.parentId!);
                if (parent)
                  documentStore.execute(
                    moveBookmark(selected, parent.parentId, parent.index + 1),
                  );
              }}
            >
              <IndentDecrease size={14} />
            </button>
            <button
              title="しおりと子のしおりを削除"
              onClick={() => {
                documentStore.execute(removeBookmark(selected));
                setSelected("");
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
