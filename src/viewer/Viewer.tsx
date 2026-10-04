import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { pageSize } from "../state/model";
import { PageView, type Tool } from "./PageView";
import { TextSelectionTools } from "../annotations/TextSelectionTools";
import { pageScale, wheelZoom, type ZoomMode } from "./zoom";
import { useViewerPosition } from "./useViewerPosition";
import { bookmarkViewport, resolveBookmarkView, type BookmarkNavigation } from "./bookmarkNavigation";
import type { DocumentSearch } from "./useDocumentSearch";
import { pageLabel } from "../pages/labels";
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
  search,
}: {
  search: DocumentSearch;
  model: DocumentModel;
  active: string;
  onActive: (id: string) => void;
  zoom: ZoomMode;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onError: (s: string) => void;
  onScale: (scale: number) => void;
  onZoom: (zoom: ZoomMode) => void;
  bookmarkNavigation: BookmarkNavigation | null;
  onBookmarkNavigated: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 800, height: 700 });
  const [editingPage, setEditingPage] = useState<string | null>(null);
  const pageEditing = useCallback((pageId: string, editing: boolean) => {
    setEditingPage(current => editing ? pageId : current === pageId ? null : current);
  }, []);
  useEffect(() => setEditingPage(null), [model.id]);
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
  const { navigation, completeNavigation } = search;
  useEffect(() => {
    if (!navigation) return;
    const el = root.current;
    const hit = search.hits.find((h) => h.id === navigation.hitId);
    if (!el || !hit) { completeNavigation(navigation.request); return; }
    const { hitId, request } = navigation, { pageId } = hit;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(locate);
    });
    const timeout = window.setTimeout(() => completeNavigation(request), 10000);
    function locate() {
      if (!el) return;
      const paper = document.getElementById(`page-${pageId}`)?.querySelector(".page-view");
      if (paper?.getAttribute("data-rendered") !== "true") return;
      const targets = paper.querySelectorAll<HTMLElement | SVGElement>(`[data-search-hit="${CSS.escape(hitId)}"]`);
      if (!targets.length) return;
      const pageBounds = paper.getBoundingClientRect(), viewport = el.getBoundingClientRect();
      const bounds = Array.from(targets, (target) => target.getBoundingClientRect())
        .find((rect) => rect.width && rect.height && rect.bottom > pageBounds.top && rect.top < pageBounds.bottom &&
          rect.right > pageBounds.left && rect.left < pageBounds.right);
      // Clipped or invisible matches keep the page navigation, without moving
      // into a neighbouring page or outside the current crop.
      if (bounds) {
        // Keep the reading line within the requested page, including matches
        // right at its top edge.
        const sectionTop = paper.closest(".page-section")!.getBoundingClientRect().top;
        el.scrollTop += Math.max(sectionTop - viewport.top,
          Math.max(pageBounds.top, bounds.top) - viewport.top - el.clientHeight * 0.35);
        if (bounds.left < viewport.left || bounds.right > viewport.right)
          el.scrollLeft += bounds.left - viewport.left - el.clientWidth * 0.25;
        activatePage.current(pageId);
        settleNavigation(pageId);
      }
      completeNavigation(request);
    }
    observer.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-rendered"] });
    frame = requestAnimationFrame(locate);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, [navigation, completeNavigation, search.hits, settleNavigation]);
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
              <span><span className="page-label-text" title={pageLabel(p, i)}>ページ {pageLabel(p, i) || "（空）"}</span>
                {p.label !== undefined && p.label !== String(i + 1) && <small>（{i + 1} / {model.pages.length}）</small>}
              </span>
              <span>
                {Math.round(size.width)} × {Math.round(size.height)} pt
              </span>
            </div>
            <PageView
              searchHits={search.byPage.get(p.id)}
              currentSearchId={search.currentId}
              model={model}
              page={p}
              active={active === p.id}
              keepVisible={editingPage === p.id}
              onEditingChange={pageEditing}
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
