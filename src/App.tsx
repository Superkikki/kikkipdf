import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  FolderOpen,
  Plus,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  PanelLeft,
  SlidersHorizontal,
  X,
  Clock3,
  Images,
} from "lucide-react";
import { useWorkspace } from "./editor/useWorkspace";
import { flushInlineText } from "./editor/flushInlineText";
import { ZoomControls } from "./components/ZoomControls";
import { PageNavigation } from "./components/PageNavigation";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Properties } from "./components/Properties";
import { Viewer } from "./viewer/Viewer";
import { useDocumentSearch } from "./viewer/useDocumentSearch";
import { PageLabelEditor } from "./pages/PageLabelEditor";
import { PageLabelNavigation } from "./pages/PageLabelNavigation";
import { Dialog } from "./components/Dialog";
import { ComparisonPanel } from "./compare/ComparisonPanel";
import { FormPanel } from "./forms/FormPanel";
import { LinkPanel } from "./links/LinkPanel";
import { Signature } from "./components/Signature";
import { APP_NAME, APP_VERSION } from "./config";
import { isTauri } from "./platform/files";
export function App() {
  const w = useWorkspace();
  const doc = w.document;
  const search = useDocumentSearch(doc, w.jump);
  const index = Math.max(0, doc?.pages.findIndex((p) => p.id === w.active) ?? 0);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showProperties, setShowProperties] = useState(() => window.innerWidth > 1150);
  useEffect(() => {
    if (w.selected) setShowProperties(true);
  }, [w.selected]);
  const [renderedScale, setRenderedScale] = useState(1);
  const [searchRequest, setSearchRequest] = useState(0);
  const { active, setActive, setSelected } = w;
  const onActive = useCallback(
    (id: string) => {
      if (id !== active) {
        if (!flushInlineText()) return;
        setActive(id);
        setSelected(null);
      }
    },
    [active, setActive, setSelected],
  );
  useEffect(() => {
    function search(e: KeyboardEvent) {
      if (
        !doc || w.busy || e.defaultPrevented || e.altKey ||
        !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f" ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }
      e.preventDefault();
      setShowSidebar(true);
      setSearchRequest((request) => request + 1);
    }
    window.addEventListener("keydown", search);
    return () => window.removeEventListener("keydown", search);
  }, [doc, w.busy]);
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (isTauri()) return;
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          /\.(pdf|kpdf)$/i.test(f.name),
        );
        if (files.length) {
          e.preventDefault();
          void Promise.all(
            files.map(async (f) => ({
              name: f.name,
              bytes: new Uint8Array(await f.arrayBuffer()),
            })),
          ).then(w.openFiles);
        }
      }}
    >
      <Toolbar
        action={w.action}
        tool={w.tool}
        setTool={w.setTool}
        hasDocument={!!doc}
        canUndo={w.canUndo}
        canRedo={w.canRedo}
        theme={w.theme}
        toggleTheme={() => w.setTheme(w.theme === "dark" ? "light" : "dark")}
        category={w.category}
        setCategory={w.setCategory}
      />
      {doc ? (
        <>
          <div className="document-tab">
            <FileText size={16} />
            <strong title={doc.name}>{doc.name}</strong>
            {w.dirty && <span className="unsaved-dot" title="未保存の変更" />}
            <span className="tab-type">PDF</span>
            <div className="document-panel-controls">
              <button
                aria-label="サイドバー"
                aria-expanded={showSidebar}
                aria-controls="document-sidebar"
                className={showSidebar ? "active" : ""}
                title={showSidebar ? "サイドバーを閉じる" : "サイドバーを表示"}
                onClick={() => setShowSidebar(!showSidebar)}
              >
                <PanelLeft size={16} />
                <span>サイドバー</span>
              </button>
              <button
                aria-label="プロパティパネル"
                aria-expanded={showProperties}
                aria-controls="document-properties"
                className={showProperties ? "active" : ""}
                title={showProperties ? "プロパティを閉じる" : "プロパティを表示"}
                onClick={() => setShowProperties(!showProperties)}
              >
                <SlidersHorizontal size={16} />
                <span>プロパティ</span>
              </button>
            </div>
          </div>
          <main className="workspace" inert={!!w.busy}>
            <Sidebar
              search={search}
              key={`sidebar:${doc.id}`}
              searchRequest={searchRequest}
              hidden={!showSidebar}
              onClose={() => setShowSidebar(false)}
              model={doc}
              active={w.active}
              jump={w.jump}
              jumpBookmark={w.jumpBookmark}
              selected={w.selected}
              selectObject={(pageId, id) => {
                w.jump(pageId);
                w.setSelected(id);
                w.setTool("select");
              }}
            />
            <Viewer
              objectMenuActions={w.objectMenuActions}
              search={search}
              key={`viewer:${doc.id}`}
              onScale={setRenderedScale}
              onZoom={w.setZoom}
              model={doc}
              active={w.active}
              onActive={onActive}
              zoom={w.zoom}
              bookmarkNavigation={w.bookmarkNavigation}
              onBookmarkNavigated={w.completeBookmarkNavigation}
              tool={w.tool}
              selected={w.selected}
              onSelect={(id) => {
                w.setSelected(id);
                w.setTool("select");
              }}
              onError={w.report}
            />
            <Properties
              page={w.page}
              selected={w.selected}
              hidden={!showProperties}
              onClose={() => setShowProperties(false)}
            />
          </main>
        </>
      ) : (
        <main className="welcome">
          <div className="welcome-content">
            <div className="eyebrow">
              <span className="local-dot" />
              YOUR DOCUMENTS, YOUR SPACE
            </div>
            <h1>PDFを、思いどおりに。</h1>
            <p className="welcome-lead">
              読む、整える、書き加える。
              <br />
              あなたのデスクトップで、すべてを完結。
            </p>
            <div className="welcome-actions">
              <button
                className="primary large"
                onClick={() => w.action("open")}
              >
                <FolderOpen size={20} />
                PDFを開く
                <ArrowRight size={18} />
              </button>
              <button className="large" onClick={() => w.action("new")}>
                <Plus size={19} />
                新規作成
              </button>
            </div>
            <div className="drop-zone">
              <div className="drop-icon">
                <FileText size={32} />
              </div>
              <strong>ここにPDFをドロップ</strong>
              <span>複数のファイルをまとめて開けます</span>
              <kbd>Ctrl + O</kbd>
            </div>
            <div className="welcome-bottom">
              <div>
                <ShieldCheck size={20} />
                <span>ファイルは端末の外に送信されません</span>
              </div>
              <button onClick={() => w.action("imagesPdf")}>
                <Images size={18} />
                画像からPDFを作成
              </button>
            </div>
          </div>
          <aside className="welcome-recent">
            <div className="recent-heading">
              <Clock3 size={19} />
              <h2>最近使ったファイル</h2>
            </div>
            {w.recent.length ? (
              w.recent.map((path) => (
                <button
                  key={path}
                  className="recent-file"
                  onClick={() => w.openRecent(path)}
                >
                  <FileText size={22} />
                  <span>
                    <strong>{path.split(/[\\/]/).pop()}</strong>
                    <small>{path}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <div className="recent-empty">
                <FileText size={35} />
                <p>作業はここから始まります</p>
                <span>開いたPDFがここに表示されます。</span>
              </div>
            )}
            <div className="welcome-tip">
              <strong>ひとつの場所で、編集から保存まで。</strong>
              <p>
                ページの並べ替え、テキストの追加、コメント。変更はいつでも元に戻せます。
              </p>
              <span>
                {APP_NAME} · v{APP_VERSION}
              </span>
            </div>
          </aside>
        </main>
      )}
      <footer className="statusbar">
        <span className="status-message" title={w.status}>
          <span className="local-dot" />
          {w.status}
        </span>
        {doc && (
          <>
            <PageLabelNavigation pages={doc.pages} index={index} jump={(n) => w.jump(doc.pages[n].id)} />
            <PageNavigation
              key={doc.id}
              index={index}
              count={doc.pages.length}
              jump={(n) => w.jump(doc.pages[n].id)}
            />
            <ZoomControls
              zoom={w.zoom}
              scale={renderedScale}
              onChange={w.setZoom}
            />
          </>
        )}
      </footer>
      {w.error && (
        <div className="error-toast" role="alert">
          <span>{w.error}</span>
          <button title="エラーを閉じる" onClick={() => w.setError("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {w.busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="spinner" />
            <h2>{w.busy.label}</h2>
            <progress max="1" value={w.busy.progress} />
            <span>{Math.round(w.busy.progress * 100)}%</span>
            <button onClick={w.cancel}>キャンセル</button>
          </div>
        </div>
      )}
      {w.dialog}
      {w.modal === "compare" && doc && (
        <Dialog title="PDF比較" wide className="comparison-dialog" onClose={() => w.setModal(null)}>
          <ComparisonPanel key={doc.id} model={doc} />
        </Dialog>
      )}
      {w.modal === "pageLabels" && doc && (
        <Dialog title="ページラベル" onClose={() => w.setModal(null)}>
          <PageLabelEditor model={doc} active={w.active} close={() => w.setModal(null)} />
        </Dialog>
      )}
      {w.modal === "links" && doc && (
        <Dialog title="リンク管理" onClose={() => w.setModal(null)}>
          <LinkPanel model={doc} jump={w.jump} />
          <footer>
            <button className="primary" onClick={() => w.setModal(null)}>
              完了
            </button>
          </footer>
        </Dialog>
      )}
      {w.modal === "forms" && doc && (
        <Dialog title="フォーム入力" onClose={() => w.setModal(null)}>
          <FormPanel model={doc} active={w.active} />
          <footer>
            <button className="primary" onClick={() => w.setModal(null)}>
              完了
            </button>
          </footer>
        </Dialog>
      )}
      {w.modal === "signature" && (
        <Signature
          close={() => w.setModal(null)}
          apply={(bytes) => {
            void w.signature(bytes);
          }}
        />
      )}
    </div>
  );
}
