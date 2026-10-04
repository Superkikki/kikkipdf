import { useEffect, useRef } from "react";
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  Type,
  ImagePlus,
  Image as ImageIcon,
  Square,
  Circle,
  ArrowUpRight,
  Minus,
  Pencil,
  Highlighter,
  Underline,
  Strikethrough,
  StickyNote,
  ScanText,
  RotateCw,
  Copy,
  Trash2,
  FilePlus2,
  PenTool,
  Shield,
  FormInput,
  Scissors,
  Sun,
  Moon,
  FileText,
  Stamp,
  Lock,
  Download,
  FileStack,
  TextCursorInput,
  Link2,
} from "lucide-react";
import { APP_NAME } from "../config";
import type { Tool } from "../viewer/PageView";
export type Action =
  | "compare"
  | "pageLabels"
  | "pageBatch"
  | "splitZip"
  | "links"
  | "print"
  | "projectOpen"
  | "projectSave"
  | "batchImages"
  | "textExport"
  | "open"
  | "new"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "rotate"
  | "duplicate"
  | "delete"
  | "blank"
  | "merge"
  | "extract"
  | "split"
  | "crop"
  | "image"
  | "imagesPdf"
  | "ocr"
  | "redact"
  | "forms"
  | "signature"
  | "savedSignature"
  | "metadata"
  | "decorate"
  | "encrypt"
  | "png"
  | "jpeg";
export function Toolbar({
  action,
  tool,
  setTool,
  hasDocument,
  canUndo,
  canRedo,
  theme,
  toggleTheme,
  category,
  setCategory,
}: {
  action: (a: Action) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  theme: string;
  toggleTheme: () => void;
  category: string;
  setCategory: (s: string) => void;
}) {
  const menubar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = menubar.current;
    if (!root) return;
    function closeMenus() {
      root?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        menu.open = false;
      });
    }
    function outside(e: PointerEvent) {
      if (!(e.target instanceof Element && root?.contains(e.target))) closeMenus();
      else if (!e.target.closest("details")) closeMenus();
    }
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const open = root?.querySelector<HTMLDetailsElement>("details[open]");
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeMenus();
        open.querySelector<HTMLElement>("summary")?.focus();
      }
    }
    function toggle(e: Event) {
      const current = e.target;
      if (!(current instanceof HTMLDetailsElement) || !current.open) return;
      root?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        if (menu !== current) menu.open = false;
      });
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    root.addEventListener("toggle", toggle, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      root.removeEventListener("toggle", toggle, true);
    };
  }, []);
  const toolHint =
    tool === "select"
      ? "文字をクリックして編集 · オブジェクトはドラッグで移動 · 元の文字はドラッグでコピー"
      : tool === "editImage"
        ? "画像の枠をダブルクリックして選択 · 移動・サイズ変更・削除ができます"
      : tool === "editText" || tool === "appearanceText"
        ? "元の文字をクリックしてその場で編集 · Enterで確定 · Escで取消"
        : tool === "text"
          ? "ページをクリックして文字を追加 · ドラッグで範囲を指定"
          : tool === "note"
            ? "ページをクリックして付箋を追加"
            : tool === "ink"
              ? "ページ上でドラッグして描画 · Escで選択ツールに戻る"
              : "ページ上でドラッグして範囲を指定 · Escで選択ツールに戻る";
  const tools = [
    { id: "select", label: "選択", icon: MousePointer2 },
    { id: "text", label: "テキスト", icon: Type },
    { id: "image", label: "画像", icon: ImagePlus },
    { id: "rect", label: "矩形", icon: Square },
    { id: "ellipse", label: "円", icon: Circle },
    { id: "line", label: "直線", icon: Minus },
    { id: "arrow", label: "矢印", icon: ArrowUpRight },
    { id: "ink", label: "ペン", icon: Pencil },
    { id: "highlight", label: "蛍光ペン", icon: Highlighter },
    { id: "underline", label: "下線", icon: Underline },
    { id: "strike", label: "取り消し線", icon: Strikethrough },
    { id: "note", label: "付箋", icon: StickyNote },
  ];
  return (
    <>
      <div className="menubar" ref={menubar}>
        <div className="brand-mark">
          k<span>•</span>
        </div>
        <span className="brand-name">{APP_NAME}</span>
        <details className="menu">
          <summary>ファイル</summary>
          <div>
            {[
              ["open", "開く", "Ctrl+O"],
              ["new", "新規PDF", ""],
              ["projectOpen", "編集プロジェクトを開く", ""],
              ["projectSave", "編集プロジェクトを保存", ""],
              ["print", "印刷", "Ctrl+P"],
              ["save", "保存", "Ctrl+S"],
              ["saveAs", "名前を付けて保存", "Ctrl+Shift+S"],
              ["merge", "PDFを結合 / 追加", ""],
              ["imagesPdf", "画像からPDFを作成", ""],
              ["png", "現在のページをPNGへ", ""],
              ["jpeg", "現在のページをJPEGへ", ""],
              ["batchImages", "ページを一括画像出力（ZIP）", ""],
              ["textExport", "テキストを抽出", ""],
              ["metadata", "文書のプロパティ", ""],
            ].map(([id, label, key]) => (
              <button
                key={id}
                disabled={
                  !hasDocument &&
                  !["open", "new", "projectOpen", "imagesPdf"].includes(id)
                }
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  action(id as Action);
                }}
              >
                {label}
                <kbd>{key}</kbd>
              </button>
            ))}
          </div>
        </details>
        <details className="menu">
          <summary>ページ</summary>
          <div>
            {[
              ["rotate", "90° 回転"],
              ["duplicate", "複製"],
              ["delete", "削除"],
              ["blank", "空白ページを追加"],
              ["extract", "ページを抽出"],
              ["split", "1ページずつ分割"],
              ["splitZip", "分割してZIPに保存"],
              ["pageBatch", "ページを一括操作"],
              ["crop", "トリミング"],
            ].map(([id, label]) => (
              <button
                disabled={!hasDocument}
                key={id}
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  action(id as Action);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </details>
        <div className="menubar-spacer" />
        <span className="local-label">
          <span className="local-dot" />
          LOCAL WORKSPACE
        </span>
        <button title="テーマ切替" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
      <div className="ribbon-tabs">
        {["編集", "ページ管理", "注釈", "ツール"].map((t) => (
          <button
            key={t}
            disabled={!hasDocument}
            aria-pressed={category === t}
            className={category === t ? "active" : ""}
            onClick={() => setCategory(t)}
          >
            {t}
          </button>
        ))}
        <div className="menubar-spacer" />
        <button className="open-button" onClick={() => action("open")}>
          <FolderOpen size={16} />
          開く
        </button>
        <button
          className="primary save-button"
          disabled={!hasDocument}
          onClick={() => action("save")}
        >
          <Save size={16} />
          保存
        </button>
      </div>
      {hasDocument && (
        <div className="toolbar">
          <div className="toolbar-tools">
            <div className="tool-group">
              <button
                title="元に戻す (Ctrl+Z)"
                disabled={!canUndo}
                onClick={() => action("undo")}
              >
                <Undo2 size={19} />
              </button>
              <button
                title="やり直す (Ctrl+Y)"
                disabled={!canRedo}
                onClick={() => action("redo")}
              >
                <Redo2 size={19} />
              </button>
            </div>
            {category === "編集" && (
              <div className="tool-group">
                <button
                  disabled={!hasDocument}
                  className={`tool ${tool === "link" ? "active" : ""}`}
                  aria-pressed={tool === "link"}
                  onClick={() => setTool("link")}
                >
                  <Link2 size={20} />
                  <span>リンク</span>
                </button>
                {tools.slice(0, 8).map((t) => (
                  <button
                    disabled={!hasDocument}
                    key={t.id}
                    className={`tool ${tool === t.id ? "active" : ""}`}
                    aria-pressed={tool === t.id}
                    title={t.label}
                    onClick={() =>
                      t.id === "image" ? action("image") : setTool(t.id as Tool)
                    }
                  >
                    <t.icon size={20} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
            {category === "注釈" && (
              <div className="tool-group">
                {tools
                  .filter((t) =>
                    [
                      "select",
                      "ink",
                      "highlight",
                      "underline",
                      "strike",
                      "note",
                    ].includes(t.id),
                  )
                  .map((t) => (
                    <button
                      disabled={!hasDocument}
                      key={t.id}
                      className={`tool ${tool === t.id ? "active" : ""}`}
                      aria-pressed={tool === t.id}
                      onClick={() => setTool(t.id as Tool)}
                    >
                      <t.icon size={20} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                <button
                  disabled={!hasDocument}
                  className="tool"
                  onClick={() => action("signature")}
                >
                  <PenTool size={20} />
                  <span>簡易署名</span>
                </button>
                <button
                  disabled={!hasDocument}
                  className="tool"
                  onClick={() => action("savedSignature")}
                >
                  <Stamp size={20} />
                  <span>登録署名</span>
                </button>
              </div>
            )}
            {category === "ページ管理" && (
              <div className="tool-group">
                {[
                  { id: "rotate", label: "回転", icon: RotateCw },
                  { id: "duplicate", label: "複製", icon: Copy },
                  { id: "delete", label: "削除", icon: Trash2 },
                  { id: "blank", label: "空白ページ", icon: FilePlus2 },
                  { id: "merge", label: "PDF追加", icon: FileStack },
                  { id: "extract", label: "抽出", icon: Download },
                  { id: "split", label: "分割", icon: Scissors },
                  { id: "splitZip", label: "分割ZIP", icon: FileStack },
                  { id: "pageBatch", label: "一括操作", icon: Copy },
                  { id: "pageLabels", label: "ページラベル", icon: FileText },
                  { id: "crop", label: "トリミング", icon: Square },
                ].map((t) => (
                  <button
                    className="tool"
                    key={t.id}
                    disabled={!hasDocument}
                    onClick={() => action(t.id as Action)}
                  >
                    <t.icon size={20} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
            {category === "ツール" && (
              <div className="tool-group">
                {[
                  { id: "ocr", label: "OCR", icon: ScanText },
                  { id: "compare", label: "PDF比較", icon: FileText },
                  { id: "forms", label: "フォーム入力", icon: FormInput },
                  { id: "links", label: "リンク管理", icon: Link2 },
                  { id: "decorate", label: "ページ装飾", icon: Stamp },
                  { id: "metadata", label: "文書情報", icon: FileText },
                  { id: "encrypt", label: "パスワード", icon: Lock },
                ].map((t) => (
                  <button
                    className="tool"
                    key={t.id}
                    disabled={!hasDocument}
                    onClick={() => action(t.id as Action)}
                  >
                    <t.icon size={20} />
                    <span>{t.label}</span>
                  </button>
                ))}
                <button
                  className={`tool ${tool === "editText" ? "active" : ""}`}
                  aria-pressed={tool === "editText"}
                  disabled={!hasDocument}
                  onClick={() => setTool("editText")}
                >
                  <TextCursorInput size={20} />
                  <span>既存文字</span>
                </button>
                <button className={`tool ${tool === "editImage" ? "active" : ""}`} aria-pressed={tool === "editImage"}
                  disabled={!hasDocument} onClick={() => setTool("editImage")}>
                  <ImageIcon size={20} /><span>既存画像</span>
                </button>
                <button
                  className={`tool ${tool === "appearanceText" ? "active" : ""}`}
                  aria-pressed={tool === "appearanceText"}
                  disabled={!hasDocument}
                  onClick={() => setTool("appearanceText")}
                  title="元の文字情報が残る見た目だけの置換"
                >
                  <Type size={20} />
                  <span>見た目の置換</span>
                </button>
                <button
                  className={`tool ${tool === "redaction" ? "active" : ""}`}
                  aria-pressed={tool === "redaction"}
                  disabled={!hasDocument}
                  onClick={() => setTool("redaction")}
                >
                  <Square size={20} />
                  <span>墨消し候補</span>
                </button>
                <button
                  className="tool"
                  disabled={!hasDocument}
                  onClick={() => action("redact")}
                >
                  <Shield size={20} />
                  <span>墨消しを適用</span>
                </button>
              </div>
            )}
          </div>
          <span className="toolbar-hint">{toolHint}</span>
        </div>
      )}
    </>
  );
}
