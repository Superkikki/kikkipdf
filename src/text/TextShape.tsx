import type { EditObject } from "../state/model";
import { useTextLayout } from "./useTextLayout";
import { previewFontFamily } from "./fonts";

export function TextShape({ object: o }: { object: EditObject }) {
  const { layout, error, pending } = useTextLayout(o, true);
  const anchor =
    o.x +
    (o.align === "center" ? o.width / 2 : o.align === "right" ? o.width : 0);
  return (
    <g>
      {o.kind === "replacement" && (
        <rect
          x={o.x}
          y={o.y}
          width={o.width}
          height={o.height}
          fill={o.fill === "none" ? "white" : o.fill}
        />
      )}
      {error && <title>{error}</title>}
      <text
        className="editable-text"
        data-layout-ready={!!layout && !pending}
        fill={o.color}
        fontSize={o.fontSize}
        fontFamily={previewFontFamily(o.font)}
        fontWeight={o.bold ? 700 : 400}
        fontStyle={o.italic ? "italic" : "normal"}
        textAnchor={
          o.align === "center"
            ? "middle"
            : o.align === "right"
              ? "end"
              : "start"
        }
        xmlSpace="preserve"
        transform={`rotate(${o.rotation} ${o.x} ${o.y + o.height})`}
      >
        {layout?.lines.map((line, i) => (
          <tspan
            key={i}
            x={anchor}
            y={o.y + line.baseline}
            textLength={line.width || undefined}
            lengthAdjust="spacingAndGlyphs"
          >
            {line.text}
          </tspan>
        ))}
      </text>
    </g>
  );
}
