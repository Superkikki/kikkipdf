import type { EditObject, FontAsset } from "../state/model";
import { useTextLayout } from "./useTextLayout";
import { previewFontFamily } from "./fonts";
import { useFontFace } from "../fonts/useFontFace";

export function TextShape({
  object: o,
  asset,
}: {
  object: EditObject;
  asset?: FontAsset;
}) {
  const { layout, error, pending } = useTextLayout(o, true, asset);
  const face = useFontFace(asset);
  if (o.writingMode === "vertical") {
    const vertical = layout?.vertical;
    const scale = o.fontSize / (vertical?.unitsPerEm ?? 1000);
    const glyphs = new Map(vertical?.glyphs.map(g => [g.id, g]));
    return <g className="editable-text" data-layout-ready={!!vertical && !pending} fill={o.color}
      transform={`rotate(${o.rotation} ${o.x} ${o.y + o.height})`}>
      <title>{error ?? o.text}</title>
      {o.kind === "replacement" && <rect x={o.x} y={o.y} width={o.width} height={o.height} fill={o.fill === "none" ? "white" : o.fill} />}
      <defs>{vertical?.glyphs.map(g => <path key={g.id} id={`vertical-${o.id}-${g.id}`} d={g.path} />)}</defs>
      {vertical?.cells.map((cell, i) => {
        const glyph = glyphs.get(cell.id)!;
        const x = o.x + o.width - o.fontSize / 2 - cell.column * o.fontSize * (o.lineHeight ?? 1.25) - glyph.width * o.fontSize / 2000;
        const y = o.y + (cell.row + 0.88) * o.fontSize;
        return <use key={i} href={`#vertical-${o.id}-${cell.id}`} transform={`translate(${x} ${y}) scale(${scale} ${-scale})`} />;
      })}
    </g>;
  }
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
      {(error || face.error) && <title>{error || face.error}</title>}
      <text
        className="editable-text"
        data-layout-ready={!!layout && !pending && face.ready}
        fill={o.textOutlineOnly ? "none" : o.color}
        stroke={o.textStrokeWidth ? o.textStrokeColor ?? o.color : undefined}
        strokeWidth={o.textStrokeWidth}
        fontSize={o.fontSize}
        fontFamily={
          o.font === "custom" && !o.fontId
            ? "sans-serif"
            : previewFontFamily(o.font, o.fontId)
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
        xmlSpace="preserve"
        transform={`rotate(${o.rotation} ${o.x} ${o.y + o.height})`}
      >
        {face.ready &&
          layout?.lines.map((line, i) => (
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
