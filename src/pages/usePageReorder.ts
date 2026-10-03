import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { reorderPage } from "../commands/document";
import { documentStore } from "../state/store";

type Target = { id: string; edge: "before" | "after" };
type Drag = { id: string; pointer: number; x: number; y: number; startX: number; startY: number; moving: boolean };

/** Pointer capture avoids the native file-drop handler that intercepts HTML drag/drop on Windows. */
export function usePageReorder(jump: (id: string) => void) {
  const drag = useRef<Drag | null>(null);
  const target = useRef<Target | null>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const [source, setSource] = useState("");
  const [drop, setDrop] = useState<Target | null>(null);

  function findTarget() {
    const d = drag.current;
    if (!d?.moving) return;
    const el = document.elementFromPoint(d.x, d.y)?.closest<HTMLElement>(".thumbnail[data-page-id]");
    const next = el && el.dataset.pageId !== d.id
      ? { id: el.dataset.pageId!, edge: d.y < el.getBoundingClientRect().top + el.clientHeight / 2 ? "before" as const : "after" as const }
      : null;
    if (next?.id !== target.current?.id || next?.edge !== target.current?.edge) {
      target.current = next;
      setDrop(next);
    }
  }

  function autoScroll() {
    const d = drag.current;
    if (!d?.moving) return;
    const list = document.querySelector<HTMLElement>(".sidebar .side-scroll");
    if (list) {
      const r = list.getBoundingClientRect();
      if (d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom) {
        const distance = 40;
        const delta = d.y < r.top + distance ? -10 : d.y > r.bottom - distance ? 10 : 0;
        if (delta) { list.scrollTop += delta; findTarget(); }
      }
    }
    frame.current = requestAnimationFrame(autoScroll);
  }

  function cancel() {
    cancelAnimationFrame(frame.current);
    drag.current = null;
    target.current = null;
    setSource("");
    setDrop(null);
  }

  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  return {
    source, drop,
    onPointerDown(e: ReactPointerEvent<HTMLElement>, id: string) {
      if (e.button !== 0 || !e.isPrimary) return;
      if (e.pointerType === "touch" && !(e.target as HTMLElement).closest(".page-drag-handle")) return;
      e.preventDefault();
      e.currentTarget.focus();
      suppressClick.current = false;
      drag.current = { id, pointer: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moving: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.moving && Math.hypot(d.x - d.startX, d.y - d.startY) > 6) {
        d.moving = true;
        suppressClick.current = true;
        setSource(d.id);
        frame.current = requestAnimationFrame(autoScroll);
      }
      findTarget();
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      findTarget();
      const destination = target.current;
      cancel();
      if (d.moving && destination) {
        documentStore.execute(reorderPage(d.id, destination.id, destination.edge));
        jump(d.id);
      }
    },
    cancel,
    click(id: string) {
      if (suppressClick.current) { suppressClick.current = false; return; }
      jump(id);
    },
  };
}
