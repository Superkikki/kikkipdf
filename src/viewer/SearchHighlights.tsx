import { useEffect, type RefObject } from "react";
import type { PageModel } from "../state/model";
import type { SearchHit } from "./search";

/** Mark existing text in place without changing its text, geometry, selection,
 * or the PDF. Added text and OCR use their editable object region. */
export function SearchHighlights({ page, hits, currentId, ready, textDivs }: {
  page: PageModel;
  hits: SearchHit[];
  currentId?: string;
  ready: boolean;
  textDivs: RefObject<HTMLElement[]>;
}) {
  useEffect(() => {
    if (!ready) return;
    const fragments = new Map<number, { start: number; end: number; id: string }[]>();
    for (const hit of hits) for (const fragment of hit.fragments) {
      if (!fragment.key.startsWith("source:")) continue;
      const index = Number(fragment.key.slice(7));
      const group = fragments.get(index) ?? [];
      group.push({ ...fragment, id: hit.id });
      fragments.set(index, group);
    }
    const changed: { div: HTMLElement; value: string }[] = [];
    for (const [index, ranges] of fragments) {
      const div = textDivs.current[index];
      if (!div) continue;
      const value = div.textContent ?? "";
      const children: Node[] = [];
      let offset = 0;
      for (const range of ranges.sort((a, b) => a.start - b.start)) {
        if (range.start < offset || range.end > value.length) continue;
        children.push(document.createTextNode(value.slice(offset, range.start)));
        const mark = document.createElement("mark");
        mark.className = `search-match${range.id === currentId ? " current-search-match" : ""}`;
        mark.dataset.searchHit = range.id;
        mark.textContent = value.slice(range.start, range.end);
        children.push(mark);
        offset = range.end;
      }
      children.push(document.createTextNode(value.slice(offset)));
      changed.push({ div, value });
      div.replaceChildren(...children);
    }
    return () => { for (const { div, value } of changed) div.textContent = value; };
  }, [ready, hits, currentId, textDivs]);
  const objectMatches = new Map<string, SearchHit>();
  for (const hit of hits) for (const part of hit.fragments) {
    if (part.key.startsWith("object:") && (!objectMatches.has(part.key) || hit.id === currentId))
      objectMatches.set(part.key, hit);
  }
  return <svg className="search-object-highlights" width={page.width} height={page.height} aria-hidden="true">
    {Array.from(objectMatches, ([key, hit]) => {
      const object = page.objects.find((o) => o.id === key.slice(7));
      if (!object) return null;
      return <rect key={key} className={`search-match${hit.id === currentId ? " current-search-match" : ""}`}
        data-search-hit={hit.id} x={object.x} y={object.y} width={object.width} height={object.height}
        transform={`rotate(${object.rotation} ${object.x} ${object.y + object.height})`} />;
    })}
  </svg>;
}
