import { useState } from "react";
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
}: {
  hidden?: boolean;
  onClose?: () => void;
  model: DocumentModel;
  active: string;
  jump: (id: string) => void;
  selected: string | null;
  selectObject: (pageId: string, id: string) => void;
}) {
  const [tab, setTab] = useState("pages");
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
      <div className="side-scroll">
        {tab === "pages" &&
          model.pages.map((p, i) => (
            <div
              key={p.id}
              className={`thumbnail ${active === p.id ? "selected" : ""}`}
              draggable
              role="button"
              tabIndex={0}
              aria-label={`ページ ${i + 1}`}
              aria-current={active === p.id ? "page" : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  jump(p.id);
                }
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-kikki-page", p.id);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-kikki-page"))
                  e.preventDefault();
              }}
              onDrop={(e) => {
                const from = e.dataTransfer.getData("application/x-kikki-page");
                if (from) {
                  e.preventDefault();
                  e.stopPropagation();
                  documentStore.execute(reorderPage(from, p.id));
                }
              }}
              onClick={() => jump(p.id)}
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
                <GripVertical size={12} />
                {i + 1}
              </span>
            </div>
          ))}
        {tab === "bookmarks" && (
          <BookmarkPanel model={model} active={active} jump={jump} />
        )}
        {tab === "comments" && <CommentsPanel model={model} jump={jump} />}
        {tab === "search" && <SearchPanel model={model} jump={jump} />}
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
          ? "ドラッグしてページを並べ替え"
          : "すべてローカルで処理"}
      </div>
    </aside>
  );
}
