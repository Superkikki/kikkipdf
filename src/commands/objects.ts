import type { EditObject } from "../state/model";
/** Keep geometric strokes in sync with their editable bounding box. */
export function patchObject(
  object: EditObject,
  patch: Partial<EditObject>,
): EditObject {
  const result = { ...object, ...patch };
  if (object.kind === "direct-image" && object.sourceImage?.bounds?.length) {
    const bounds = object.sourceImage.bounds;
    const left = Math.max(...bounds.map(b => b.x)), top = Math.max(...bounds.map(b => b.y));
    const right = Math.min(...bounds.map(b => b.x + b.width)), bottom = Math.min(...bounds.map(b => b.y + b.height));
    result.width = Math.min(Math.max(1, result.width), right - left);
    result.height = Math.min(Math.max(1, result.height), bottom - top);
    result.x = Math.max(left, Math.min(right - result.width, result.x));
    result.y = Math.max(top, Math.min(bottom - result.height, result.y));
  }
  if (
    object.kind === "ocr" &&
    patch.text !== undefined &&
    patch.text !== object.text &&
    patch.ocrReviewed === undefined
  )
    result.ocrReviewed = false;
  if (
    object.points &&
    !patch.points &&
    (patch.width !== undefined || patch.height !== undefined)
  ) {
    result.points = object.points.map((p) => ({
      x: (p.x * result.width) / object.width,
      y: (p.y * result.height) / object.height,
    }));
  }
  return result;
}
