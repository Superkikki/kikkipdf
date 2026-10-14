import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, RotateCw, Trash2 } from "lucide-react";
import { documentStore } from "../state/store";

export type PageAction = "rotate" | "duplicate" | "delete";
export interface PageMenuAnchor {
  pageId: string;
  anchor: HTMLElement;
  x: number;
  y: number;
}

export function PageContextMenu({ target, run, close }: {
  target: PageMenuAnchor;
  run: (action: PageAction, pageId: string) => void;
  close: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const anchorBounds = useRef<DOMRect | null>(null);
  const { anchor, pageId, x, y } = target;
  function restoreFocus() {
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function choose(action: PageAction) {
    const doc = documentStore.document;
    close();
    restoreFocus();
    if (anchor.isConnected && !anchor.closest("[inert],[hidden]") &&
      doc?.pages.some((page) => page.id === pageId) &&
      (action !== "delete" || doc.pages.length > 1)) run(action, pageId);
  }
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    anchorBounds.current = anchor.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [x, y, anchor]);
  useEffect(() => {
    function outside(e: Event) {
      if (e.target instanceof Node && !menu.current?.contains(e.target)) close();
    }
    function scroll() {
      const before = anchorBounds.current;
      const now = anchor.getBoundingClientRect();
      // A queued scroll from bringing the trigger into view can arrive after opening.
      if (!anchor.isConnected || (before && (before.top !== now.top || before.left !== now.left))) close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [close, anchor]);
  return createPortal(
    <div ref={menu} className="object-context-menu page-context-menu" role="menu"
      aria-label="ページの操作" style={{ left: x, top: y }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation(); close(); restoreFocus();
        } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 :
            (current + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus({ preventScroll: true });
        } else if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey) close();
      }}>
      <button role="menuitem" onClick={() => choose("rotate")}><RotateCw size={16} /><span>90° 回転</span></button>
      <button role="menuitem" onClick={() => choose("duplicate")}><Copy size={16} /><span>複製</span></button>
      <div role="separator" />
      <button role="menuitem" className="danger" disabled={(documentStore.document?.pages.length ?? 0) <= 1}
        onClick={() => choose("delete")}><Trash2 size={16} /><span>削除</span></button>
    </div>, document.body,
  );
}
