import type { EditObject, Point } from "../state/model";

export function isEditableText(object: EditObject) {
  return object.kind === "text" || object.kind === "direct-text" || object.kind === "replacement";
}

/** Use displayed character bounds, so PDF scaling, wrapping and rotation are respected. */
export function textCaretAtPoint(root: Element, value: string, point: Point, rotation = 0, vertical = false) {
  const radians = rotation * Math.PI / 180;
  const direction = vertical
    ? { x: -Math.sin(radians), y: Math.cos(radians) }
    : { x: Math.cos(radians), y: Math.sin(radians) };
  let best = { distance: Infinity, offset: value.length };
  function consider(rect: DOMRect, start: number, end: number) {
    if (!rect.width && !rect.height) return;
    const half = (Math.abs(direction.x) * rect.width + Math.abs(direction.y) * rect.height) / 2;
    for (const [sign, offset] of [[-1, start], [1, end]]) {
      const x = rect.left + rect.width / 2 + sign * direction.x * half;
      const y = rect.top + rect.height / 2 + sign * direction.y * half;
      const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
      if (distance < best.distance) best = { distance, offset };
    }
  }
  const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest("title") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let cursor = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const start = value.indexOf(text, cursor);
    if (start < 0) continue;
    for (const part of segmenter.segment(text)) {
      const range = document.createRange();
      range.setStart(node, part.index);
      range.setEnd(node, part.index + part.segment.length);
      consider(range.getBoundingClientRect(), start + part.index, start + part.index + part.segment.length);
    }
    cursor = start + text.length;
  }
  if (best.distance === Infinity && vertical) {
    const glyphs = root.querySelectorAll("use");
    const characters = Array.from(segmenter.segment(value)).filter(part => !/[\r\n]/u.test(part.segment));
    glyphs.forEach((glyph, index) => {
      const part = characters[index];
      if (part) consider(glyph.getBoundingClientRect(), part.index, part.index + part.segment.length);
    });
  }
  return best.offset;
}

/** Grow the hit area with the edited text, keeping the vertical right edge fixed. */
export function inlineTextPatch(
  object: EditObject,
  text: string,
  layout?: { width: number; height: number },
): Partial<EditObject> {
  if (text === (object.text ?? "")) return {};
  const patch: Partial<EditObject> = { text };
  if (!layout || !text) return patch;
  if (object.writingMode === "vertical") {
    const width = Math.max(object.width, Math.ceil(layout.width));
    patch.x = object.x + object.width - width;
    patch.width = width;
    patch.height = Math.max(object.height, Math.ceil(layout.height));
  } else {
    patch.width = Math.max(object.width, Math.ceil(layout.width));
    patch.height = Math.max(object.height, Math.ceil(layout.height));
    if (object.rotation && patch.height !== object.height) {
      const angle = object.rotation * Math.PI / 180, growth = patch.height - object.height;
      patch.x = object.x - Math.sin(angle) * growth;
      patch.y = object.y + (Math.cos(angle) - 1) * growth;
    }
  }
  return patch;
}
