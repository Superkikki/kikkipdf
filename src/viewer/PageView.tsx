import { FormOverlay } from "../forms/FormOverlay";
import { useEffect, useRef, useState } from "react";
import { TextLayer, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  DocumentModel,
  ObjectKind,
  PageModel,
  Point,
} from "../state/model";
import { newObject, pageSize } from "../state/model";
import { screenToPage } from "./coordinates";
import { sourcePdf } from "./pdf";
import { Overlay } from "../editor/Overlay";
import { documentStore } from "../state/store";
import { addObject } from "../commands/document";
import { appearanceTextEngine } from "../editor/textEngine";
export type Tool = "select" | "editText" | ObjectKind;
export function PageView({
  model,
  page,
  scale,
  thumbnail = false,
  tool = "select",
  selected = null,
  onSelect = () => {},
  onActive = () => {},
  onError,
}: {
  model: DocumentModel;
  page: PageModel;
  scale: number;
  thumbnail?: boolean;
  tool?: Tool;
  selected?: string | null;
  onSelect?: (id: string) => void;
  onActive?: () => void;
  onError?: (s: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    content = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [ready, setReady] = useState(false);
  const drawing = useRef<{ start: Point; points: Point[] } | null>(null);
  const [draft, setDraft] = useState<{ a: Point; b: Point } | null>(null);
  const source = page.sourceId ? model.sources[page.sourceId] : undefined;
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries[0].isIntersecting);
      },
      { rootMargin: thumbnail ? "120px" : "600px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!visible) {
      setReady(false);
      return;
    }
    let cancelled = false,
      render: RenderTask | undefined,
      layer: TextLayer | undefined;
    const canvasEl = canvas.current,
      textEl = text.current;
    async function draw() {
      if (!source) {
        setReady(true);
        return;
      }
      const pdf = await sourcePdf(source!);
      const p = await pdf.getPage(page.sourceIndex + 1);
      if (cancelled || !canvasEl) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rasterScale = Math.min(
        scale * ratio,
        Math.sqrt(12_000_000 / (page.width * page.height)),
      );
      const viewport = p.getViewport({ scale: rasterScale, rotation: 0 });
      canvasEl.width = Math.ceil(viewport.width);
      canvasEl.height = Math.ceil(viewport.height);
      render = p.render({ canvas: canvasEl, viewport, annotationMode: 2 });
      await render.promise;
      if (cancelled) return;
      if (textEl && !thumbnail) {
        textEl.replaceChildren();
        const viewport = p.getViewport({ scale: 1, rotation: 0 });
        textEl.style.setProperty("--scale-factor", "1");
        textEl.style.setProperty("--total-scale-factor", "1");
        layer = new TextLayer({
          textContentSource: await p.getTextContent(),
          container: textEl,
          viewport,
        });
        await layer.render();
      }
      if (!cancelled) setReady(true);
    }
    void draw().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException")
        onError?.("ページの描画に失敗しました。");
    });
    return () => {
      cancelled = true;
      render?.cancel();
      layer?.cancel();
      textEl?.replaceChildren();
      if (canvasEl) {
        canvasEl.width = 0;
        canvasEl.height = 0;
      }
    };
  }, [
    visible,
    source,
    page.sourceIndex,
    page.width,
    page.height,
    scale,
    thumbnail,
    onError,
  ]);
  const crop = page.crop ?? {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  };
  const size = pageSize(page);
  const rotate =
    page.rotation === 90
      ? `translate(${crop.height}px,0) rotate(90deg)`
      : page.rotation === 180
        ? `translate(${crop.width}px,${crop.height}px) rotate(180deg)`
        : page.rotation === 270
          ? `translate(0,${crop.width}px) rotate(270deg)`
          : "none";
  function point(e: React.PointerEvent): Point {
    const el = content.current!;
    const transform = el.getBoundingClientRect();
    const p = screenToPage(
      { x: e.clientX - transform.left, y: e.clientY - transform.top },
      page.width,
      page.height,
      page.rotation,
      scale,
    );
    return {
      x: Math.max(0, Math.min(page.width, p.x)),
      y: Math.max(0, Math.min(page.height, p.y)),
    };
  }

  function down(e: React.PointerEvent) {
    onActive();
    if (
      thumbnail ||
      tool === "select" ||
      tool === "editText" ||
      tool === "image"
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    drawing.current = { start: p, points: [p] };
    setDraft({ a: p, b: p });
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const p = point(e);
    drawing.current.points.push(p);
    setDraft({ a: drawing.current.start, b: p });
  }
  function up(e: React.PointerEvent) {
    if (!drawing.current) return;
    const d = drawing.current;
    const end = point(e);
    drawing.current = null;
    setDraft(null);
    if (tool === "select" || tool === "editText") return;
    const o = newObject(
      tool,
      Math.min(d.start.x, end.x),
      Math.min(d.start.y, end.y),
    );
    const w = Math.abs(end.x - d.start.x),
      h = Math.abs(end.y - d.start.y);
    if (w > 5) o.width = w;
    if (h > 5) o.height = h;
    if (tool === "link") o.link = { kind: "page", pageId: page.id };
    if (tool === "ink") {
      const xs = d.points.map((p) => p.x),
        ys = d.points.map((p) => p.y);
      o.x = Math.min(...xs);
      o.y = Math.min(...ys);
      o.width = Math.max(8, Math.max(...xs) - o.x);
      o.height = Math.max(8, Math.max(...ys) - o.y);
      o.points = d.points.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
    }
    documentStore.execute(addObject(page.id, o));
    onSelect(o.id);
  }
  async function existing(e: React.MouseEvent) {
    if (tool !== "editText" || !source) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".textLayer span")) return;
    const textValue = target.textContent ?? "";
    const rect = target.getBoundingClientRect();
    const points = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
    ].map(([clientX, clientY]) =>
      point({ clientX, clientY } as React.PointerEvent),
    );
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    const o = appearanceTextEngine.replace(
      textValue,
      box,
      Math.max(8, box.height * 0.85),
    );
    documentStore.execute(addObject(page.id, o));
    onSelect(o.id);
  }
  return (
    <div
      ref={host}
      className={`page-view ${thumbnail ? "mini" : ""}`}
      style={{ width: size.width * scale, height: size.height * scale }}
      data-page-id={page.id}
      data-rendered={visible && ready ? "true" : "false"}
    >
      {visible ? (
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: size.width,
            height: size.height,
          }}
        >
          <div
            style={{
              width: crop.width,
              height: crop.height,
              transform: rotate,
              transformOrigin: "top left",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              ref={content}
              className={`page-content tool-${tool}`}
              style={{
                width: page.width,
                height: page.height,
                marginLeft: -crop.x,
                marginTop: -crop.y,
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drawing.current = null;
                setDraft(null);
              }}
              onDoubleClick={(e) => {
                void existing(e);
              }}
            >
              <FormOverlay
                fields={(model.formFields ?? []).filter(
                  (f) => f.pageId === page.id,
                )}
                thumbnail={!!thumbnail}
              />
              <canvas
                ref={canvas}
                style={{ width: page.width, height: page.height }}
              />
              {!thumbnail && (
                <div
                  ref={text}
                  className="textLayer"
                  style={{
                    width: page.width,
                    height: page.height,
                    pointerEvents:
                      tool === "select" || tool === "editText"
                        ? "auto"
                        : "none",
                  }}
                />
              )}
              <Overlay
                model={model}
                page={page}
                selected={selected}
                onSelect={onSelect}
                interactive={!thumbnail && tool === "select"}
              />
              {draft && (
                <svg
                  className="draft-layer"
                  width={page.width}
                  height={page.height}
                >
                  <rect
                    x={Math.min(draft.a.x, draft.b.x)}
                    y={Math.min(draft.a.y, draft.b.y)}
                    width={Math.abs(draft.b.x - draft.a.x)}
                    height={Math.abs(draft.b.y - draft.a.y)}
                    fill="#18a99920"
                    stroke="#18a999"
                    strokeWidth={1}
                  />
                </svg>
              )}
            </div>
          </div>
        </div>
      ) : (
        <span className="page-placeholder">
          {thumbnail ? "" : "ページを準備"}
        </span>
      )}
    </div>
  );
}
