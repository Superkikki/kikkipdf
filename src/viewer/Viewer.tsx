import { useEffect, useRef, useState } from "react";
import type { DocumentModel } from "../state/model";
import { pageSize } from "../state/model";
import { PageView, type Tool } from "./PageView";
export type ZoomMode = "width" | "page" | number;
export function Viewer({
  model,
  active,
  onActive,
  zoom,
  tool,
  selected,
  onSelect,
  onError,
}: {
  model: DocumentModel;
  active: string;
  onActive: (id: string) => void;
  zoom: ZoomMode;
  tool: Tool;
  selected: string | null;
  onSelect: (id: string) => void;
  onError: (s: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 800, height: 700 });
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
      {model.pages.map((p, i) => {
        const size = pageSize(p);
        const scale =
          typeof zoom === "number"
            ? zoom
            : zoom === "width"
              ? Math.max(0.15, (space.width - 88) / size.width)
              : Math.max(
                  0.15,
                  Math.min(
                    (space.width - 88) / size.width,
                    (space.height - 70) / size.height,
                  ),
                );
        return (
          <section
            key={p.id}
            id={`page-${p.id}`}
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
