import type { Box, EditObject } from "../state/model";

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Recognized = { text: string; bbox: Bbox };
/** Preserve Tesseract's glyph positions instead of estimating positions from a
 * replacement font. Offsets refer to the original UTF-16 recognition text. */
export function recognitionGeometry(line: Recognized & {
  words: (Recognized & { symbols?: Recognized[] })[];
}): EditObject["ocrGeometry"] {
  const text = line.text.trimEnd(), bounds = line.bbox;
  const width = bounds.x1 - bounds.x0, height = bounds.y1 - bounds.y0;
  if (!(width > 0 && height > 0)) return;
  const boxes: NonNullable<EditObject["ocrGeometry"]>["boxes"] = [];
  let offset = 0;
  for (const word of line.words) {
    const parts = word.symbols?.length ? word.symbols : [word];
    for (const part of parts) {
      if (!part.text || !part.text.trim()) continue;
      const start = text.indexOf(part.text, offset);
      if (start < 0 || text.slice(offset, start).trim()) return;
      const end = start + part.text.length;
      const x0 = Math.max(bounds.x0, part.bbox.x0), y0 = Math.max(bounds.y0, part.bbox.y0);
      const x1 = Math.min(bounds.x1, part.bbox.x1), y1 = Math.min(bounds.y1, part.bbox.y1);
      if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return;
      boxes.push({ start, end, x: (x0 - bounds.x0) / width, y: (y0 - bounds.y0) / height,
        width: (x1 - x0) / width, height: (y1 - y0) / height });
      offset = end;
    }
  }
  if (!boxes.length || text.slice(offset).trim()) return;
  return { text, boxes };
}

export function recognizedBoxes(object: EditObject) {
  const geometry = object.ocrGeometry;
  if (object.kind !== "ocr" || !geometry || geometry.text !== object.text) return [];
  return geometry.boxes.map(b => ({ ...b, x: object.x + b.x * object.width,
    y: object.y + b.y * object.height, width: b.width * object.width, height: b.height * object.height }));
}

export function recognizedMatch(object: EditObject, start: number, end: number): Box | undefined {
  const boxes = recognizedBoxes(object).filter(b => b.start < end && b.end > start);
  if (!boxes.length) return;
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
    height: Math.max(...boxes.map(b => b.y + b.height)) - y };
}
