import { useEffect, useRef, useState } from "react";
import {
  Files,
  Bookmark,
  MessageSquare,
  Search,
  GripVertical,
  X,
  Paperclip,
  ScanText,
} from "lucide-react";
import type { DocumentModel } from "../state/model";
import { pageSize } from "../state/model";
import { documentStore } from "../state/store";
import { usePageReorder } from "../pages/usePageReorder";
import { reorderPage } from "../commands/document";
import { PageView } from "../viewer/PageView";
import { SearchPanel } from "../viewer/SearchPanel";
import { CommentsPanel } from "../annotations/CommentsPanel";
import { BookmarkPanel } from "../pages/BookmarkPanel";
import { AttachmentPanel } from "../attachments/AttachmentPanel";
import { ReviewPanel } from "../ocr/ReviewPanel";
export function Sidebar({
  model,
  active,
  jump,
  selected,
  selectObject,
  hidden = false,
  onClose,
  searchRequest = 0,
}: {
  searchRequest?: number;
  hidden?: boolean;
  onClose?: () => void;
  model: DocumentModel;
  active: string;
  jump: (id: string) => void;
  selected: string | null;
  selectObject: (pageId: string, id: string) => void;
}) {
  const [tab, setTab] = useState("pages");
  const reorder = usePageReorder(jump);
  const scroll = useRef<HTMLDivElement>(null);
  const lastSearchRequest = useRef(searchRequest);
  useEffect(() => {
    if (searchRequest !== lastSearchRequest.current) {
      lastSearchRequest.current = searchRequest;
      setTab("search");
    }
  }, [searchRequest]);
  useEffect(() => {
    if (hidden || tab !== "pages") return;
    const el = scroll.current;
    const selected = el?.querySelector<HTMLElement>(".thumbnail.selected");
    if (!el || !selected) return;
    const viewport = el.getBoundingClientRect();
    const bounds = selected.getBoundingClientRect();
    if (bounds.top < viewport.top) el.scrollTop += bounds.top - viewport.top - 8;
    else if (bounds.bottom > viewport.bottom) el.scrollTop += bounds.bottom - viewport.bottom + 8;
  }, [active, tab, hidden, model.pages]);
  return (
    <aside
      className="sidebar"
      id="document-sidebar"
      aria-label="文書のサイドバー"
      hidden={hidden}
    >
      <div className="side-tabs">
        {[
          { id: "pages", label: "ページ", icon: Files },
          { id: "bookmarks", label: "しおり", icon: Bookmark },
          { id: "comments", label: "コメント", icon: MessageSquare },
          { id: "search", label: "検索", icon: Search },
          { id: "attachments", label: "添付ファイル", icon: Paperclip },
          { id: "ocr", label: "OCR校正", icon: ScanText },
        ].map((t) => (
          <button
            title={t.label}
            aria-pressed={tab === t.id}
            aria-label={t.label}
            className={tab === t.id ? "active" : ""}
            key={t.id}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={19} />
          </button>
        ))}
      </div>
      <div className="side-heading">
        <strong>
          {tab === "pages"
            ? "ページ一覧"
            : tab === "bookmarks"
              ? "しおり"
              : tab === "comments"
                ? "コメント"
                : tab === "attachments"
                  ? "添付ファイル"
                  : tab === "ocr"
                    ? "OCR校正"
                    : "文書内を検索"}
        </strong>
        <span>{model.pages.length} ページ</span>
        <button
          className="panel-close"
          title="サイドバーを閉じる"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="side-scroll" ref={scroll}>
        {tab === "pages" &&
          model.pages.map((p, i) => (
            <div
              key={p.id}
              className={`thumbnail ${active === p.id ? "selected" : ""} ${reorder.source === p.id ? "dragging" : ""} ${reorder.drop?.id === p.id ? `drop-${reorder.drop.edge}` : ""}`}
              data-page-id={p.id}
              role="button"
              tabIndex={0}
              aria-label={`ページ ${i + 1}`}
              aria-current={active === p.id ? "page" : undefined}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  e.stopPropagation();
                  const target = model.pages[i + (e.key === "ArrowUp" ? -1 : 1)];
                  if (target) {
                    documentStore.execute(reorderPage(p.id, target.id));
                    jump(p.id);
                  }
                  return;
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  jump(p.id);
                }
              }}
              onPointerDown={(e) => reorder.onPointerDown(e, p.id)}
              onPointerMove={reorder.onPointerMove}
              onPointerUp={reorder.onPointerUp}
              onPointerCancel={reorder.cancel}
              onLostPointerCapture={reorder.cancel}
              onClick={() => reorder.click(p.id)}
            >
              <div className="thumb-paper">
                <PageView
                  model={model}
                  page={p}
                  scale={132 / pageSize(p).width}
                  thumbnail
                />
              </div>
              <span>
                <GripVertical className="page-drag-handle" size={16} aria-label="ページをドラッグして並べ替え" />
                {i + 1}
              </span>
            </div>
          ))}
        {tab === "bookmarks" && (
          <BookmarkPanel model={model} active={active} jump={jump} />
        )}
        {tab === "comments" && <CommentsPanel model={model} jump={jump} />}
        {tab === "search" && (
          <SearchPanel model={model} jump={jump} focusRequest={searchRequest} />
        )}
        {tab === "attachments" && <AttachmentPanel model={model} />}
        {tab === "ocr" && (
          <ReviewPanel
            model={model}
            active={active}
            selected={selected}
            select={selectObject}
          />
        )}
      </div>
      <div className="side-footer">
        {tab === "pages"
          ? "ドラッグで並べ替え · Alt＋↑／↓でも移動"
          : "すべてローカルで処理"}
      </div>
    </aside>
  );
}
