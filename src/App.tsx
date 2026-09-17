import {
  FileText,
  FolderOpen,
  Plus,
  ArrowRight,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus as ZoomIn,
  X,
  Clock3,
  Images,
} from "lucide-react";
import { useWorkspace } from "./editor/useWorkspace";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { Properties } from "./components/Properties";
import { Viewer } from "./viewer/Viewer";
import { Dialog } from "./components/Dialog";
import { FormPanel } from "./forms/FormPanel";
import { LinkPanel } from "./links/LinkPanel";
import { Signature } from "./components/Signature";
import { APP_NAME, APP_VERSION } from "./config";
import { isTauri } from "./platform/files";
export function App() {
  const w = useWorkspace();
  const doc = w.document;
  const index = doc?.pages.findIndex((p) => p.id === w.active) ?? 0;
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
            <strong>{doc.name}</strong>
            {w.dirty && <span className="unsaved-dot" title="未保存の変更" />}
            <span className="tab-type">PDF</span>
          </div>
          <main className="workspace" inert={!!w.busy}>
            <Sidebar
              model={doc}
              active={w.active}
              jump={w.jump}
              selected={w.selected}
              selectObject={(pageId, id) => {
                w.jump(pageId);
                w.setSelected(id);
                w.setTool("select");
              }}
            />
            <Viewer
              model={doc}
              active={w.active}
              onActive={w.setActive}
              zoom={w.zoom}
              tool={w.tool}
              selected={w.selected}
              onSelect={(id) => {
                w.setSelected(id);
                w.setTool("select");
              }}
              onError={w.report}
            />
            <Properties page={w.page} selected={w.selected} />
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
        <span className="status-message">
          <span className="local-dot" />
          {w.status}
        </span>
        {doc && (
          <>
            <div className="page-navigation">
              <button
                title="前のページ"
                disabled={index <= 0}
                onClick={() => w.jump(doc.pages[index - 1].id)}
              >
                <ChevronLeft size={16} />
              </button>
              <input
                aria-label="ページ番号"
                type="number"
                min="1"
                max={doc.pages.length}
                value={index + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= doc.pages.length)
                    w.jump(doc.pages[n - 1].id);
                }}
              />
              <span>/ {doc.pages.length}</span>
              <button
                title="次のページ"
                disabled={index >= doc.pages.length - 1}
                onClick={() => w.jump(doc.pages[index + 1].id)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="zoom-controls">
              <button
                title="縮小"
                onClick={() =>
                  w.setZoom(
                    Math.max(
                      0.25,
                      (typeof w.zoom === "number" ? w.zoom : 1) - 0.25,
                    ),
                  )
                }
              >
                <Minus size={15} />
              </button>
              <select
                aria-label="ズーム"
                value={String(w.zoom)}
                onChange={(e) =>
                  w.setZoom(
                    ["width", "page"].includes(e.target.value)
                      ? (e.target.value as "width" | "page")
                      : Number(e.target.value),
                  )
                }
              >
                <option value="width">ページ幅に合わせる</option>
                <option value="page">ページ全体を表示</option>
                {[
                  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3,
                  3.25, 3.5, 3.75, 4,
                ].map((n) => (
                  <option value={n} key={n}>
                    {n * 100}%
                  </option>
                ))}
              </select>
              <button
                title="拡大"
                onClick={() =>
                  w.setZoom(
                    Math.min(
                      4,
                      (typeof w.zoom === "number" ? w.zoom : 1) + 0.25,
                    ),
                  )
                }
              >
                <ZoomIn size={15} />
              </button>
            </div>
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
