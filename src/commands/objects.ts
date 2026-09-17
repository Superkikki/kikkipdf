import type { EditObject } from "../state/model";
/** Keep geometric strokes in sync with their editable bounding box. */
export function patchObject(
  object: EditObject,
  patch: Partial<EditObject>,
): EditObject {
  const result = { ...object, ...patch };
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
