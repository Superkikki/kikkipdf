import { useEffect, useState } from "react";
import { Highlighter, Underline, Strikethrough } from "lucide-react";
import type { DocumentModel } from "../state/model";
import { documentStore } from "../state/store";
import {
  selectedTextMarkup,
  selectionBox,
  type SelectedPageText,
  type TextMarkupKind,
} from "./textSelection";

interface SelectedText {
  pages: SelectedPageText[];
  left: number;
  top: number;
  count: number;
}
export function TextSelectionTools({
  model,
  root,
  onApplied,
}: {
  model: DocumentModel;
  root: React.RefObject<HTMLDivElement | null>;
  onApplied: (pageId: string, objectId: string) => void;
}) {
  const [selected, setSelected] = useState<SelectedText>();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      if (
        !range ||
        range.collapsed ||
        !root.current ||
        !selection?.toString().trim()
      ) {
        setSelected(undefined);
        return;
      }
      const pages: SelectedPageText[] = [];
      let last: DOMRect | undefined,
        count = 0;
      for (const view of root.current.querySelectorAll<HTMLElement>(
        ".page-view[data-rendered=true]",
      )) {
        const page = model.pages.find((p) => p.id === view.dataset.pageId);
        const content = view.querySelector<HTMLElement>(".page-content");
        const layer = view.querySelector(".textLayer");
        if (!page || !content || !layer || !range.intersectsNode(layer))
          continue;
        const bounds = content.getBoundingClientRect();
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        const fragments: SelectedPageText["fragments"] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!range.intersectsNode(node)) continue;
          const local = document.createRange();
          local.selectNodeContents(node);
          if (node === range.startContainer)
            local.setStart(node, range.startOffset);
          if (node === range.endContainer) local.setEnd(node, range.endOffset);
          const value = local.toString();
          if (!value.trim()) continue;
          for (const rect of local.getClientRects()) {
            const box = selectionBox(
              page,
              {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
              { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            );
            if (box) {
              fragments.push({ ...box, text: value });
              last = rect;
            }
          }
          count += value.length;
        }
        if (fragments.length) pages.push({ pageId: page.id, fragments });
      }
      setSelected(
        last && pages.length
          ? {
              pages,
              count,
              left: Math.max(8, Math.min(window.innerWidth - 328, last.left)),
              top: Math.max(
                8,
                Math.min(window.innerHeight - 68, last.bottom + 8),
              ),
            }
          : undefined,
      );
    };
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 60);
    };
    document.addEventListener("selectionchange", update);
    root.current?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    const element = root.current;
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", update);
      element?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [model, root]);
  if (!selected) return null;
  const apply = (kind: TextMarkupKind) => {
    const result = selectedTextMarkup(selected.pages, kind);
    documentStore.execute(result.command);
    window.getSelection()?.removeAllRanges();
    setSelected(undefined);
    if (result.pageId && result.objectId)
      onApplied(result.pageId, result.objectId);
  };
  return (
    <div
      role="toolbar"
      aria-label="選択文字への注釈"
      className="text-selection-tools"
      style={{ left: selected.left, top: selected.top }}
      onPointerDown={(e) => e.preventDefault()}
    >
      <span>{selected.count} 文字</span>
      <button onClick={() => apply("highlight")}>
        <Highlighter size={15} />
        蛍光ペン
      </button>
      <button onClick={() => apply("underline")}>
        <Underline size={15} />
        下線
      </button>
      <button onClick={() => apply("strike")}>
        <Strikethrough size={15} />
        取り消し線
      </button>
    </div>
  );
}
