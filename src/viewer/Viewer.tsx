import { useEffect, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { pageSize } from "../state/model";
import { PageView, type Tool } from "./PageView";
import { TextSelectionTools } from "../annotations/TextSelectionTools";
import { pageScale, wheelZoom, type ZoomMode } from "./zoom";
import { useViewerPosition } from "./useViewerPosition";
import { bookmarkViewport, resolveBookmarkView, type BookmarkNavigation } from "./bookmarkNavigation";
export type { ZoomMode } from "./zoom";
export function Viewer({
  model,
  active,
  onActive,
  zoom,
  tool,
  selected,
  onSelect,
  onError,
  onScale,
  onZoom,
  bookmarkNavigation,
  onBookmarkNavigated,
}: {
  model: DocumentModel;
  active: string;
  onActive: (id: string) => void;
  zoom: ZoomMode;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string) => void;
  onError: (s: string) => void;
  onScale: (scale: number) => void;
  onZoom: (zoom: ZoomMode) => void;
  bookmarkNavigation: BookmarkNavigation | null;
  onBookmarkNavigated: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 800, height: 700 });
  const { anchorZoom, settleNavigation } = useViewerPosition(root, model, active, onActive, zoom, space);
  const activePage = model.pages.find((p) => p.id === active) ?? model.pages[0];
  const activeScale = pageScale(pageSize(activePage), space, zoom);
  const zoomState = useRef({ scale: activeScale, onZoom, anchorZoom });
  zoomState.current = { scale: activeScale, onZoom, anchorZoom };
  const currentModel = useRef(model);
  currentModel.current = model;
  const currentZoom = useRef(zoom);
  currentZoom.current = zoom;
  const activatePage = useRef(onActive);
  activatePage.current = onActive;
  useEffect(() => {
    const navigation = bookmarkNavigation;
    if (!navigation) return;
    if (navigation.documentId !== model.id) { onBookmarkNavigated(navigation.id); return; }
    const target = model.pages.find((p) => p.id === navigation.pageId);
    if (!target) { onBookmarkNavigated(navigation.id); return; }
    let cancelled = false, frame = 0;
    const live = () => !cancelled && currentModel.current.id === navigation.documentId &&
      currentModel.current.pages.find((p) => p.id === target.id) === target;
    void bookmarkViewport(model, target).then((viewport) => {
      const el = root.current;
      if (!el || !live()) { onBookmarkNavigated(navigation.id); return; }
      const view = resolveBookmarkView(target, viewport, navigation.destination,
        { width: el.clientWidth, height: el.clientHeight }, currentZoom.current);
      onZoom(view.zoom);
      // Wait for zoom geometry and reading-position restoration before moving to the destination.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const pageView = document.getElementById(`page-${target.id}`)?.querySelector<HTMLElement>(".page-view");
          if (!pageView || !live()) { onBookmarkNavigated(navigation.id); return; }
          const bounds = pageView.getBoundingClientRect(), visible = el.getBoundingClientRect();
          const size = pageSize(target), scale = bounds.width / size.width;
          const x = Math.max(0, Math.min(size.width - 1, view.point.x));
          const y = Math.max(0, Math.min(size.height - 1, view.point.y));
          el.scrollTop += bounds.top - visible.top - el.clientTop + y * scale;
          el.scrollLeft += bounds.left - visible.left - el.clientLeft + x * scale;
          activatePage.current(target.id);
          settleNavigation(target.id);
          onBookmarkNavigated(navigation.id);
        });
      });
    }).catch((e) => {
      if (live()) onError(e instanceof Error ? e.message : "しおりの移動先を表示できません。");
      onBookmarkNavigated(navigation.id);
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
    // Only a new request navigates; unrelated document edits must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkNavigation, model.id]);
  useEffect(() => {
    const el = root.current!;
    let frame = 0;
    let pending: number | undefined;
    function wheel(e: WheelEvent) {
      if (!e.ctrlKey || !Number.isFinite(e.deltaY) || e.deltaY === 0) return;
      e.preventDefault();
      zoomState.current.anchorZoom(e.clientX, e.clientY);
      pending = wheelZoom(pending ?? zoomState.current.scale, e.deltaY, e.deltaMode);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pending !== undefined) zoomState.current.onZoom(pending);
        pending = undefined;
      });
    }
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => onScale(activeScale), [activeScale, onScale]);
  useEffect(() => {
    const el = root.current!;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSpace({ width: r.width, height: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={root} className="viewer-scroll" id="viewer-scroll">
      <TextSelectionTools
        model={model}
        root={root}
        onApplied={(pageId, id) => {
          onActive(pageId);
          onSelect(id);
        }}
      />
      {model.pages.map((p, i) => {
        const size = pageSize(p);
        const scale = pageScale(size, space, zoom);
        return (
          <section
            key={p.id}
            id={`page-${p.id}`}
            data-page-id={p.id}
            className={`page-section ${active === p.id ? "active-page" : ""}`}
            onMouseDown={() => onActive(p.id)}
          >
            <div className="page-caption">
              <span>ページ {i + 1}</span>
              <span>
                {Math.round(size.width)} × {Math.round(size.height)} pt
              </span>
            </div>
            <PageView
              model={model}
              page={p}
              scale={scale}
              tool={tool}
              selected={selected}
              onSelect={onSelect}
              onActive={() => onActive(p.id)}
              onError={onError}
            />
          </section>
        );
      })}
      <div className="document-end">
        ドキュメントの終わり · {model.pages.length} ページ
      </div>
    </div>
  );
}
