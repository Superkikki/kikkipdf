import { useId } from "react";
import type { ImportedMarkup, PageModel } from "../state/model";

function renderedMarkup(markup: ImportedMarkup) {
  const color = markup.color ?? (markup.subtype === "Text" || markup.subtype === "Highlight" ? "#ffce32" : "#263445");
  const width = Math.max(markup.strokeWidth, 0.5);
  const common = { stroke: color, strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (markup.subtype === "Text") return <g fill={color} stroke="#5b4d20" strokeWidth={0.7}>
    <rect x={markup.x} y={markup.y} width={markup.width} height={markup.height} rx={Math.min(2, markup.width / 4)} />
    <path d={`M ${markup.x + markup.width * 0.2} ${markup.y + markup.height * 0.35} h ${markup.width * 0.6}
      M ${markup.x + markup.width * 0.2} ${markup.y + markup.height * 0.6} h ${markup.width * 0.45}`} />
  </g>;
  if (markup.subtype === "Ink") return markup.gestures?.map((gesture, index) => gesture.length === 1
    ? <circle key={index} cx={gesture[0].x} cy={gesture[0].y} r={Math.max(markup.strokeWidth / 2, 0.5)} fill={color} />
    : <polyline key={index} points={gesture.map(point => `${point.x},${point.y}`).join(" ")} fill="none" {...common} />);
  const quads = markup.quadPoints ?? [];
  return Array.from({ length: quads.length / 4 }, (_, index) => {
    const [a, b, c, d] = quads.slice(index * 4, index * 4 + 4);
    if (markup.subtype === "Highlight") return <polygon key={index}
      points={[a, b, d, c].map(point => `${point.x},${point.y}`).join(" ")} fill={color} />;
    const start = markup.subtype === "Underline" ? c : { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const end = markup.subtype === "Underline" ? d : { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 };
    return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} {...common} />;
  });
}

export function ImportedMarkupOverlay({ page }: { page: PageModel }) {
  const clipPrefix = useId();
  const markups = page.importedMarkups ?? [];
  const displayed = markups.filter(markup => markup.color !== null && !((markup.flags ?? 0) & (1 | 2 | 32)));
  if (!markups.length) return null;
  return <svg className="imported-markup-layer" width={page.width} height={page.height}
    viewBox={`0 0 ${page.width} ${page.height}`} aria-hidden="true"
    style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 2 }}>
    <defs>{displayed.map((markup, index) => <clipPath key={markup.id} id={`${clipPrefix}-${index}`}>
      <rect x={markup.x} y={markup.y} width={markup.width} height={markup.height} />
    </clipPath>)}</defs>
    {displayed.map((markup, index) =>
      <g key={markup.id} data-imported-markup-id={markup.id} data-subtype={markup.subtype}
        clipPath={`url(#${clipPrefix}-${index})`}
        opacity={markup.opacity} style={markup.subtype === "Highlight" ? { mixBlendMode: "multiply" } : undefined}>
        {renderedMarkup(markup)}
      </g>)}
  </svg>;
}
