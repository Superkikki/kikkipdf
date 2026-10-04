import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import type { EditObject, FontAsset } from "../state/model";
import { previewFontFamily } from "../text/fonts";
import { useFontFace } from "../fonts/useFontFace";
import { useTextLayout } from "../text/useTextLayout";
import { inlineTextPatch } from "./inlineText";
import { INLINE_TEXT_COMMIT } from "./flushInlineText";

export function InlineTextEditor({
  object,
  asset,
  scale,
  caret,
  selectAll = false,
  onCommit,
  onCancel,
}: {
  object: EditObject;
  asset?: FontAsset;
  scale: number;
  caret?: number;
  selectAll?: boolean;
  onCommit: (patch: Partial<EditObject>) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(object.text ?? "");
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const input = useRef<HTMLTextAreaElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const finished = useRef(false);
  const queuedCommit = useRef(false);
  const initial = useRef(object);
  const mounted = useRef(false);
  const useJapanese = object.font !== "custom" && object.font !== "japanese" &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u.test(value);
  const draft = { ...object, text: value, font: useJapanese ? "japanese" as const : object.font };
  const { layout, error, pending } = useTextLayout(draft, false, asset);
  const face = useFontFace(asset);
  const latest = useRef({ draft, layout, error: error ?? face.error, pending: draft.font === "custom" && (pending || !face.ready), onCommit, onCancel });
  latest.current = { draft, layout, error: error ?? face.error, pending: draft.font === "custom" && (pending || !face.ready), onCommit, onCancel };
  const vertical = object.writingMode === "vertical";

  function finish(cancel = false) {
    if (finished.current) return true;
    if (cancel) {
      finished.current = true;
      latest.current.onCancel();
      return true;
    }
    if (composing.current) return false;
    if (latest.current.pending) {
      queuedCommit.current = true;
      return false;
    }
    if (latest.current.error) {
      input.current?.focus({ preventScroll: true });
      return false;
    }
    finished.current = true;
    const el = input.current;
    // Native measurements cover a quick Enter before the layout worker replies.
    const measured = el ? {
      width: Math.max(1, el.scrollWidth - 8),
      height: Math.max(1, el.scrollHeight - 8),
    } : undefined;
    latest.current.onCommit({
      ...inlineTextPatch(initial.current, latest.current.draft.text ?? "", latest.current.layout ?? measured),
      ...(latest.current.draft.font !== initial.current.font ? { font: latest.current.draft.font } : {}),
    });
    return true;
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (queuedCommit.current && !pending && face.ready) {
      queuedCommit.current = false;
      finishRef.current();
    }
  }, [pending, face.ready]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (selectAll) el.select();
    else {
      const offset = Math.max(0, Math.min(el.value.length, caret ?? el.value.length));
      el.setSelectionRange(offset, offset);
    }
    // The initial click places the caret once; zoom and typing keep it intact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    if (vertical) {
      el.style.width = `${Math.max(object.width, object.fontSize * 1.25) + 8}px`;
      el.style.width = `${Math.max(el.scrollWidth, (layout?.width ?? 0) + 8)}px`;
    } else {
      el.style.height = `${object.fontSize * (object.lineHeight ?? 1.25) + 8}px`;
      el.style.height = `${Math.max(el.scrollHeight, (layout?.height ?? 0) + 8)}px`;
    }
  }, [value, layout, vertical, object.width, object.fontSize, object.lineHeight]);

  useEffect(() => {
    if (object !== initial.current) finishRef.current(true);
  }, [object]);

  useEffect(() => {
    mounted.current = true;
    function inside(target: EventTarget | null) {
      return target instanceof Node && (!!input.current?.contains(target) || !!toolbar.current?.contains(target));
    }
    let blockedOutsideClick = false;
    function outside(e: Event) {
      // A text tool opens on pointerup; its following click must not immediately
      // commit the newly mounted editor. Click only blocks a rejected pointerdown.
      if (e.type === "click" && !blockedOutsideClick) return;
      if (e.type === "pointerdown") blockedOutsideClick = false;
      if (inside(e.target) || (e instanceof PointerEvent && e.button !== 0)) return;
      // Native IME blur/compositionend must still run, but application selection
      // must wait for a successful commit before replacing the editor.
      if (!finishRef.current()) {
        if (e.type === "pointerdown") blockedOutsideClick = true;
        if (e.cancelable && !composing.current) e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    function shortcut(e: KeyboardEvent) {
      if (!inside(e.target)) return;
      if (e.isComposing || composing.current || e.keyCode === 229) {
        if (e.key === "Enter" || e.key === "Escape") e.stopPropagation();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishRef.current(true);
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        finishRef.current();
      } else if ((e.ctrlKey || e.metaKey) && ["s", "p", "o"].includes(e.key.toLowerCase())) {
        // Flush synchronously before workspace shortcuts take their PDF snapshot.
        if (!finishRef.current()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
    function flush(e: Event) {
      if (!finishRef.current()) e.preventDefault();
    }
    window.addEventListener(INLINE_TEXT_COMMIT, flush);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("keydown", shortcut, true);
    return () => {
      mounted.current = false;
      window.removeEventListener(INLINE_TEXT_COMMIT, flush);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("keydown", shortcut, true);
      // Scrolling can unmount a page without a pointer/focus event. Defer to
      // distinguish it from StrictMode's effect cleanup and immediate remount.
      queueMicrotask(() => { if (!mounted.current) finishRef.current(); });
    };
  }, []);

  useLayoutEffect(() => {
    function place() {
      const bounds = input.current?.getBoundingClientRect();
      const controls = toolbar.current?.getBoundingClientRect();
      if (!bounds || !controls) return;
      setPosition({
        x: Math.max(8, Math.min(bounds.left, window.innerWidth - controls.width - 8)),
        y: Math.max(8, bounds.bottom + controls.height + 12 < window.innerHeight
          ? bounds.bottom + 6 : Math.min(bounds.top - controls.height - 6, window.innerHeight - controls.height - 8)),
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [value, layout, scale, object.x, object.y, error, face.error]);

  return <>
    <textarea
      ref={input}
      className="inline-text-editor"
      data-layout-ready={!!layout && !pending && face.ready}
      aria-label="ページ上のテキスト編集"
      aria-describedby={`inline-text-help-${object.id}`}
      value={value}
      placeholder="文字を入力"
      spellCheck={false}
      wrap={object.wrap ? "soft" : "off"}
      onChange={e => { queuedCommit.current = false; setValue(e.target.value); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={e => {
        composing.current = false;
        setValue(e.currentTarget.value);
        latest.current.draft.text = e.currentTarget.value;
        if (latest.current.draft.font === "custom") latest.current.pending = true;
        if (latest.current.draft.font !== "custom" &&
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u.test(e.currentTarget.value)) {
          latest.current.draft.font = "japanese";
          latest.current.layout = undefined;
        }
        if (document.activeElement !== e.currentTarget) finishRef.current();
      }}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        left: object.x - 4,
        top: object.y - 4,
        width: vertical ? object.width + 8 : Math.max(object.width, object.wrap ? 0 : (layout?.width ?? 0), 40 / scale) + 8,
        height: vertical ? Math.max(object.height, object.wrap ? 0 : (layout?.height ?? 0)) + 8 : undefined,
        fontFamily: previewFontFamily(draft.font, object.fontId),
        fontSize: object.fontSize,
        fontWeight: object.bold ? 700 : 400,
        fontStyle: object.italic ? "italic" : "normal",
        color: object.color,
        textAlign: object.align,
        lineHeight: object.lineHeight ?? 1.25,
        writingMode: vertical ? "vertical-rl" : "horizontal-tb",
        transform: `rotate(${object.rotation}deg)`,
        transformOrigin: `4px ${object.height + 4}px`,
      }}
    />
    {createPortal(<div
      ref={toolbar}
      className="inline-text-toolbar"
      role="toolbar"
      aria-label="文字編集の操作"
      style={{ left: position.x, top: position.y }}
      onPointerDown={e => e.stopPropagation()}
    >
      <span id={`inline-text-help-${object.id}`}>Enterで確定 · Shift+Enterで改行 · Escで取消</span>
      {useJapanese && <span className="inline-font-hint">日本語フォントを適用</span>}
      <button aria-label="文字編集を確定" title="文字編集を確定（Enter）" disabled={!!(error || face.error)} onClick={() => finish()}><Check size={16} /></button>
      <button aria-label="文字編集を取り消す" title="文字編集を取り消す（Esc）" onClick={() => finish(true)}><X size={16} /></button>
      {(error || face.error) && <p role="alert">{error || face.error}</p>}
    </div>, document.body)}
  </>;
}
