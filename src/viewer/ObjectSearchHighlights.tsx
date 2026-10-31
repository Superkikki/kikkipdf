import { useLayoutEffect, useRef, useState } from "react";
import type { EditObject, FontAsset } from "../state/model";
import { useTextLayout } from "../text/useTextLayout";
import { useFontFace } from "../fonts/useFontFace";
import { previewFontFamily } from "../text/fonts";
import type { SearchHit } from "./search";

type Box = { x: number; y: number; width: number; height: number; id: string };
const displayText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

/** Measure the same SVG layout as the editable text, in page coordinates. OCR
 * has only a line bounding box, so fit the measured text to that region. */
export function ObjectSearchHighlights({ object: o, asset, hits, currentId }: {
  object: EditObject; asset?: FontAsset; hits: SearchHit[]; currentId?: string;
}) {
  const { layout, pending } = useTextLayout(o, false, asset);
  const face = useFontFace(asset);
  const text = useRef<SVGTextElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  useLayoutEffect(() => {
    const boxes: Box[] = [];
    if (layout && !pending && face.ready) {
      const source = o.text ?? "";
      const value = displayText(source);
      const ranges = hits.flatMap(hit => hit.fragments.filter(f => f.key === `object:${o.id}`)
        .map(f => ({ id: hit.id, start: displayText(source.slice(0, f.start)).length,
          end: displayText(source.slice(0, f.end)).length })));
      let offset = 0;
      if (layout.vertical) {
        for (const cell of layout.vertical.cells) {
          offset = value.indexOf(cell.text, offset);
          for (const range of ranges) if (offset < range.end && offset + cell.text.length > range.start) {
            boxes.push({ id: range.id,
              x: o.x + o.width - o.fontSize - cell.column * o.fontSize * (o.lineHeight ?? 1.25),
              y: o.y + cell.row * o.fontSize, width: o.fontSize, height: o.fontSize });
          }
          offset += cell.text.length;
        }
      } else {
        const spans = text.current?.querySelectorAll("tspan");
        layout.lines.forEach((line, i) => {
          const span = spans?.[i];
          offset = value.indexOf(line.text, offset);
          if (span && line.text.length) for (const range of ranges) {
            const start = Math.max(0, range.start - offset);
            const end = Math.min(line.text.length, range.end - offset);
            if (start >= end) continue;
            // SVG character positions use the same UTF-16 offsets as search.
            const rects = Array.from({ length: end - start }, (_, j) => span.getExtentOfChar(start + j));
            const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
            boxes.push({ id: range.id, x, y,
              width: Math.max(...rects.map(r => r.x + r.width)) - x,
              height: Math.max(...rects.map(r => r.y + r.height)) - y });
          }
          offset += line.text.length;
        });
      }
    }
    setBoxes(boxes);
  }, [layout, pending, face.ready, o, hits]);
  const anchor = o.x + (o.align === "center" ? o.width / 2 : o.align === "right" ? o.width : 0);
  return <g transform={`rotate(${o.rotation} ${o.x} ${o.y + o.height})`}>
    <text ref={text} visibility="hidden" fontSize={o.fontSize}
      fontFamily={o.font === "custom" && !o.fontId ? "sans-serif" : previewFontFamily(o.font, o.fontId)}
      fontWeight={o.bold ? 700 : 400} fontStyle={o.italic ? "italic" : "normal"}
      textAnchor={o.align === "center" ? "middle" : o.align === "right" ? "end" : "start"} xmlSpace="preserve">
      {!layout?.vertical && face.ready && layout?.lines.map((line, i) => <tspan key={i}
        x={o.kind === "ocr" ? o.x : anchor} y={o.y + line.baseline}
        textAnchor={o.kind === "ocr" ? "start" : undefined}
        textLength={(o.kind === "ocr" ? o.width : line.width) || undefined} lengthAdjust="spacingAndGlyphs">{line.text}</tspan>)}
    </text>
    {boxes.map((box, i) => <rect key={i} className={`search-match${box.id === currentId ? " current-search-match" : ""}`}
      data-search-hit={box.id} x={box.x} y={box.y} width={box.width} height={box.height} />)}
  </g>;
}
