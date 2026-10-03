import { useEffect, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { pageSize } from "../state/model";
import { PageView, type Tool } from "./PageView";
import { TextSelectionTools } from "../annotations/TextSelectionTools";
import { pageScale, wheelZoom, type ZoomMode } from "./zoom";
import { useViewerPosition } from "./useViewerPosition";
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
}) {
  const root = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 800, height: 700 });
  const anchorZoom = useViewerPosition(root, model, active, onActive, zoom, space);
  const activePage = model.pages.find((p) => p.id === active) ?? model.pages[0];
  const activeScale = pageScale(pageSize(activePage), space, zoom);
  const zoomState = useRef({ scale: activeScale, onZoom, anchorZoom });
  zoomState.current = { scale: activeScale, onZoom, anchorZoom };
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
