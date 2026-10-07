import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Copy, Scissors, ClipboardPaste, Files, Pencil, ArrowUpToLine, ArrowDownToLine, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { deleteObject } from "../commands/document";
import { documentStore } from "../state/store";
import { reorderObject, type ObjectMenuActions, type ObjectMenuAction } from "./objectActions";
import { isEditableText } from "./inlineText";
import type { EditObject, Point } from "../state/model";

export function ObjectContextMenu({
  objectMenuActions,
  onEditText,
  pageId,
  objectId,
  point,
  anchor,
  onClose,
}: {
  objectMenuActions?: ObjectMenuActions;
  onEditText?: (object: EditObject) => void;
  pageId: string;
  objectId: string;
  point: Point;
  anchor: SVGElement;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const page = documentStore.document?.pages.find(p => p.id === pageId);
  const object = page?.objects.find(o => o.id === objectId);
  const index = page?.objects.findIndex(o => o.id === objectId) ?? -1;
  const liveObject = () => anchor.isConnected && !anchor.closest("[inert]") &&
    documentStore.document?.pages.find(p => p.id === pageId)?.objects.find(o => o.id === objectId);
  function run(action: ObjectMenuAction) {
    if (liveObject()) objectMenuActions?.run(action, pageId, objectId);
    onClose();
    restoreFocus();
  }
  function reorder(direction: "front" | "back" | "forward" | "backward") {
    if (liveObject()) documentStore.execute(reorderObject(pageId, objectId, direction));
    onClose();
    restoreFocus();
  }
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect(),
      padding = 8;
    el.style.left = `${Math.max(padding, Math.min(point.x, window.innerWidth - bounds.width - padding))}px`;
    el.style.top = `${Math.max(padding, Math.min(point.y, window.innerHeight - bounds.height - padding))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [point.x, point.y, anchor]);
  useEffect(() => {
    const outside = (e: Event) => {
      if (e.target instanceof Node && !menu.current?.contains(e.target))
        onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("contextmenu", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("contextmenu", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("scroll", outside, true);
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
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 :
            (current + (e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0) + items.length) % items.length;
          items[next]?.focus();
        } else if (e.key === "Delete") {
          e.preventDefault();
          e.stopPropagation();
          remove();
        } else if (e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey)
          onClose();
      }}
    >
      {objectMenuActions && <>
        <button role="menuitem" disabled={object?.kind === "direct-image" && object.imageDeleted} onClick={() => run("copy")}>
          <Copy size={16} /><span>コピー</span><kbd aria-hidden="true">Ctrl+C</kbd>
        </button>
        <button role="menuitem" disabled={object?.kind === "direct-image" && object.imageDeleted} onClick={() => run("cut")}>
          <Scissors size={16} /><span>切り取り</span><kbd aria-hidden="true">Ctrl+X</kbd>
        </button>
        <button role="menuitem" disabled={!objectMenuActions.canPaste()} onClick={() => run("paste")}>
          <ClipboardPaste size={16} /><span>貼り付け</span><kbd aria-hidden="true">Ctrl+V</kbd>
        </button>
        <button role="menuitem" disabled={object?.kind === "direct-image" && object.imageDeleted} onClick={() => run("duplicate")}>
          <Files size={16} /><span>複製</span><kbd aria-hidden="true">Ctrl+D</kbd>
        </button>
        <div role="separator" />
      </>}
      {object && isEditableText(object) && onEditText && <>
        <button role="menuitem" onClick={() => {
          const current = liveObject();
          onClose();
          if (current) onEditText(current);
        }}><Pencil size={16} /><span>文字を編集</span></button>
        <div role="separator" />
      </>}
      {object?.kind !== "direct-image" && <>
        <button role="menuitem" disabled={index === (page?.objects.length ?? 0) - 1} onClick={() => reorder("front")}>
          <ArrowUpToLine size={16} /><span>最前面へ</span>
        </button>
        <button role="menuitem" disabled={index === (page?.objects.length ?? 0) - 1} onClick={() => reorder("forward")}>
          <ArrowUp size={16} /><span>一つ前面へ</span>
        </button>
        <button role="menuitem" disabled={index <= 0} onClick={() => reorder("backward")}>
          <ArrowDown size={16} /><span>一つ背面へ</span>
        </button>
        <button role="menuitem" disabled={index <= 0} onClick={() => reorder("back")}>
          <ArrowDownToLine size={16} /><span>最背面へ</span>
        </button>
        <div role="separator" />
      </>}
      <button role="menuitem" className="danger" onClick={remove}>
        <Trash2 size={16} />
        <span>削除</span>
        <kbd aria-hidden="true">Delete</kbd>
      </button>
    </div>,
    document.body,
  );
}
