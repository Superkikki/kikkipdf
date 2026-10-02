import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { deleteObject } from "../commands/document";
import { documentStore } from "../state/store";
import type { Point } from "../state/model";

export function ObjectContextMenu({
  pageId,
  objectId,
  point,
  anchor,
  onClose,
}: {
  pageId: string;
  objectId: string;
  point: Point;
  anchor: SVGElement;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect(),
      padding = 8;
    el.style.left = `${Math.max(padding, Math.min(point.x, window.innerWidth - bounds.width - padding))}px`;
    el.style.top = `${Math.max(padding, Math.min(point.y, window.innerHeight - bounds.height - padding))}px`;
    el.querySelector("button")?.focus({ preventScroll: true });
  }, [point.x, point.y, anchor]);
  useEffect(() => {
    const outside = (e: Event) => {
      if (e.target instanceof Node && !menu.current?.contains(e.target))
        onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const restoreFocus = () => {
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  function remove() {
    // Revalidate against the current model; a popup must never bypass busy/inert UI.
    const page = documentStore.document?.pages.find((p) => p.id === pageId);
    if (
      anchor.isConnected &&
      !anchor.closest("[inert]") &&
      page?.objects.some((o) => o.id === objectId)
    )
      documentStore.execute(deleteObject(pageId, objectId));
    onClose();
    restoreFocus();
  }
  return createPortal(
    <div
      ref={menu}
      className="object-context-menu"
      role="menu"
      aria-label="オブジェクトの操作"
      style={{ left: point.x, top: point.y }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          restoreFocus();
        } else if (
          [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
          ].includes(e.key)
        ) {
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === "Delete") {
          e.preventDefault();
          e.stopPropagation();
          remove();
        } else if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey)
          onClose();
      }}
    >
      <button role="menuitem" onClick={remove}>
        <Trash2 size={16} />
        <span>削除</span>
        <kbd aria-hidden="true">Delete</kbd>
      </button>
    </div>,
    document.body,
  );
}
