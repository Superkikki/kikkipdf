import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { DocumentModel } from "../state/model";
import type { ZoomMode } from "./zoom";

type Anchor = { documentId: string; pageId: string; x: number; y: number; offsetX: number; offsetY: number };

export function useViewerPosition(
  root: RefObject<HTMLDivElement | null>,
  model: DocumentModel,
  active: string,
  onActive: (id: string) => void,
  zoom: ZoomMode,
  space: { width: number; height: number },
) {
  const sections = useRef<HTMLElement[]>([]);
  const anchor = useRef<Anchor | null>(null);
  const restoredTop = useRef<number | null>(null);
  const latest = useRef({ active, onActive, documentId: model.id });
  latest.current = { active, onActive, documentId: model.id };

  const remember = useCallback((pageId: string) => {
    const el = root.current;
    const section = sections.current.find((s) => s.dataset.pageId === pageId);
    if (!el || !section) return;
    const viewport = el.getBoundingClientRect();
    const bounds = section.getBoundingClientRect();
    anchor.current = {
      documentId: latest.current.documentId,
      pageId,
      x: (viewport.left + el.clientWidth / 2 - bounds.left) / bounds.width,
      y: (viewport.top - bounds.top) / bounds.height,
      offsetX: el.clientWidth / 2,
      offsetY: 0,
    };
  }, [root]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    sections.current = Array.from(el.querySelectorAll<HTMLElement>(".page-section"));
    const previous = anchor.current;
    if (previous?.documentId === model.id) {
      const section = sections.current.find((s) => s.dataset.pageId === previous.pageId);
      if (section) {
        const viewport = el.getBoundingClientRect();
        const bounds = section.getBoundingClientRect();
        el.scrollTop += bounds.top - viewport.top + previous.y * bounds.height - previous.offsetY;
        el.scrollLeft += bounds.left - viewport.left + previous.x * bounds.width - previous.offsetX;
        restoredTop.current = el.scrollTop;
      }
    } else {
      el.scrollTop = 0;
      el.scrollLeft = 0;
      restoredTop.current = 0;
    }
    remember(latest.current.active);
    // Geometry changes restore the last reading position; an active-page change
    // alone comes from navigation or clicking and must not move the viewport.
  }, [remember, root, model.id, model.pages, zoom, space.width, space.height]);

  useLayoutEffect(() => {
    remember(active);
  }, [active, remember]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    function scroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el || !sections.current.length) return;
        if (restoredTop.current !== null && Math.abs(el.scrollTop - restoredTop.current) < 1) {
          restoredTop.current = null;
          remember(latest.current.active);
          return;
        }
        restoredTop.current = null;
        // Binary search reads only a few page positions, including in long PDFs.
        const readingLine = el.getBoundingClientRect().top + 32;
        let low = 0;
        let high = sections.current.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (sections.current[middle].getBoundingClientRect().top <= readingLine) low = middle;
          else high = middle - 1;
        }
        const id = sections.current[low].dataset.pageId;
        if (!id) return;
        remember(id);
        if (id !== latest.current.active) latest.current.onActive(id);
      });
    }
    el.addEventListener("scroll", scroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
    // Scroll uses the current callbacks and page elements through refs.
  }, [remember, root]);
  return useCallback((clientX: number, clientY: number) => {
    const el = root.current;
    if (!el) return;
    const section = sections.current.find((s) => {
      const r = s.getBoundingClientRect();
      return clientY >= r.top && clientY <= r.bottom;
    });
    if (!section?.dataset.pageId) return;
    const bounds = section.getBoundingClientRect();
    const viewport = el.getBoundingClientRect();
    anchor.current = {
      documentId: latest.current.documentId,
      pageId: section.dataset.pageId,
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height,
      offsetX: clientX - viewport.left,
      offsetY: clientY - viewport.top,
    };
  }, [root]);
}
