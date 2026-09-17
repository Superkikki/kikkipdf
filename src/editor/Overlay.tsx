import { useEffect, useRef, useState } from "react";
import type {
  DocumentModel,
  EditObject,
  PageModel,
  Point,
} from "../state/model";
import { documentStore } from "../state/store";
import { patchObject } from "../commands/objects";
import { updateObject } from "../commands/document";
function AssetImage({
  object,
  model,
}: {
  object: EditObject;
  model: DocumentModel;
}) {
  const asset = object.imageId ? model.images[object.imageId] : undefined;
  const [href, setHref] = useState("");
  useEffect(() => {
    if (!asset) {
      setHref("");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }),
    );
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [asset]);
  return (
    <image
      href={href}
      x={object.x}
      y={object.y}
      width={object.width}
      height={object.height}
      preserveAspectRatio="none"
      transform={`rotate(${object.rotation} ${object.x} ${object.y + object.height})`}
    />
  );
}
export function ObjectShape({
  o,
  model,
}: {
  o: EditObject;
  model: DocumentModel;
}) {
  const { x, y, width: w, height: h } = o;
  const common = { stroke: o.color, strokeWidth: o.strokeWidth, fill: o.fill };
  if (o.kind === "image") return <AssetImage object={o} model={model} />;
  if (o.kind === "ocr")
    return (
      <rect
        className="ocr-region"
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#168bcc18"
        stroke="#168bcc"
        strokeWidth={1.2}
      >
        <title>OCRの認識領域</title>
      </rect>
    );
  if (o.kind === "link")
    return (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#078c7f15"
        stroke="#078c7f"
        strokeDasharray="5 3"
      >
        <title>リンク領域（枠は編集画面のみ）</title>
      </rect>
    );
  if (["text", "replacement", "ocr"].includes(o.kind))
    return (
      <g>
        {o.kind === "replacement" && (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill={o.fill === "none" ? "white" : o.fill}
          />
        )}
        <text
          x={x + (o.align === "center" ? w / 2 : o.align === "right" ? w : 0)}
          y={y + o.fontSize}
          fill={o.color}
          fontSize={o.fontSize}
          fontFamily={
            o.font === "mono"
              ? "monospace"
              : o.font === "serif"
                ? "serif"
                : "Noto Sans JP, sans-serif"
          }
          fontWeight={o.bold ? 700 : 400}
          fontStyle={o.italic ? "italic" : "normal"}
          textAnchor={
            o.align === "center"
              ? "middle"
              : o.align === "right"
                ? "end"
                : "start"
          }
          transform={`rotate(${o.rotation} ${x} ${y + h})`}
        >
          {(o.text ?? "").split("\n").map((line, i) => (
            <tspan
              key={i}
              x={
                x + (o.align === "center" ? w / 2 : o.align === "right" ? w : 0)
              }
              dy={i ? o.fontSize * 1.25 : 0}
            >
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  if (o.kind === "ellipse")
    return (
      <ellipse
        cx={x + w / 2}
        cy={y + h / 2}
        rx={w / 2}
        ry={h / 2}
        {...common}
      />
    );
  if (o.kind === "ink")
    return (
      <polyline
        points={o.points?.map((p) => `${p.x + x},${p.y + y}`).join(" ")}
        {...common}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (o.kind === "note")
    return (
      <g>
        <rect x={x} y={y} width={24} height={24} rx={4} fill="#ffce32" />
        <path
          d={`M${x + 6} ${y + 7}h12m-12 5h12m-12 5h8`}
          stroke="#785c10"
          strokeWidth={1.5}
        />
        <title>{o.text}</title>
      </g>
    );
  if (["line", "arrow", "underline", "strike"].includes(o.kind)) {
    const y1 = y + h,
      y2 = o.kind === "line" || o.kind === "arrow" ? y : y1;
    return (
      <g {...common}>
        <line
          x1={x}
          y1={o.kind === "strike" ? y + h / 2 : y1}
          x2={x + w}
          y2={o.kind === "strike" ? y + h / 2 : y2}
        />
        {o.kind === "arrow" && (
          <path
            d={`M${x + w - 12} ${y2 + 3}L${x + w} ${y2}L${x + w - 3} ${y2 + 12}`}
            fill="none"
          />
        )}
      </g>
    );
  }
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      {...common}
      {...(o.kind === "redaction"
        ? { fill: "#ef444430", stroke: "#ef4444", strokeDasharray: "6 3" }
        : {})}
    />
  );
}
export function Overlay({
  page,
  model,
  selected,
  onSelect,
  interactive,
}: {
  page: PageModel;
  model: DocumentModel;
  selected: string | null;
  onSelect: (id: string) => void;
  interactive: boolean;
}) {
  const [preview, setPreview] = useState<EditObject | null>(null);
  const drag = useRef<{ o: EditObject; point: Point; resize: boolean } | null>(
    null,
  );
  const svg = useRef<SVGSVGElement>(null);
  function point(e: React.PointerEvent) {
    const m = svg.current?.getScreenCTM()?.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  }
  function start(e: React.PointerEvent, o: EditObject, resize = false) {
    if (!interactive) return;
    e.stopPropagation();
    onSelect(o.id);
    drag.current = { o, point: point(e), resize };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(e),
      dx = p.x - d.point.x,
      dy = p.y - d.point.y;
    setPreview(
      patchObject(d.o, {
        ...(d.resize
          ? {
              width: Math.max(8, d.o.width + dx),
              height: Math.max(8, d.o.height + dy),
            }
          : {
              x: Math.max(0, Math.min(page.width - d.o.width, d.o.x + dx)),
              y: Math.max(0, Math.min(page.height - d.o.height, d.o.y + dy)),
            }),
      }),
    );
  }
  function end() {
    if (preview)
      documentStore.execute(updateObject(page.id, preview.id, preview));
    drag.current = null;
    setPreview(null);
  }
  return (
    <svg
      ref={svg}
      className="object-layer"
      width={page.width}
      height={page.height}
      viewBox={`0 0 ${page.width} ${page.height}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      style={{ pointerEvents: "none" }}
    >
      {page.objects
        .filter((o) => o.kind !== "ocr" || o.id === selected)
        .map((original) => {
          const o = preview?.id === original.id ? preview : original;
          return (
            <g
              key={o.id}
              opacity={o.kind === "ocr" ? 1 : o.opacity}
              style={{
                pointerEvents: interactive ? "all" : "none",
                cursor: interactive ? "move" : "default",
              }}
              onPointerDown={(e) => start(e, o)}
            >
              <ObjectShape o={o} model={model} />
              <rect
                x={o.x}
                y={o.y}
                width={o.width}
                height={o.height}
                fill="transparent"
                stroke={selected === o.id ? "#18a999" : "none"}
                strokeWidth={1}
                strokeDasharray="4 2"
              />
              {selected === o.id && interactive && (
                <rect
                  x={o.x + o.width - 5}
                  y={o.y + o.height - 5}
                  width={10}
                  height={10}
                  fill="#18a999"
                  stroke="white"
                  onPointerDown={(e) => start(e, o, true)}
                />
              )}
            </g>
          );
        })}
    </svg>
  );
}
