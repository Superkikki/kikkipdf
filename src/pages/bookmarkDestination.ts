import { z } from "zod";
import type { BookmarkDestination } from "../state/model";

const coordinate = z.number().finite().min(-1e6).max(1e6);
export const bookmarkDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("XYZ"), left: coordinate.nullable(), top: coordinate.nullable(), zoom: z.number().finite().min(0).max(100).nullable() }),
  z.object({ kind: z.enum(["Fit", "FitB"]) }),
  z.object({ kind: z.enum(["FitH", "FitBH"]), top: coordinate.nullable() }),
  z.object({ kind: z.enum(["FitV", "FitBV"]), left: coordinate.nullable() }),
  z.object({ kind: z.literal("FitR"), left: coordinate, bottom: coordinate, right: coordinate, top: coordinate })
    .refine((d) => d.right > d.left && d.top > d.bottom, { message: "しおりの表示範囲が不正です。" }),
]);

/** Only recognized, correctly sized destination arrays are retained. */
export function readBookmarkDestination(dest: unknown): BookmarkDestination | undefined {
  if (!Array.isArray(dest)) return;
  const kind = dest[1]?.name;
  let value: unknown;
  switch (kind) {
    case "XYZ":
      if (dest.length !== 5) return;
      value = { kind, left: dest[2], top: dest[3], zoom: dest[4] }; break;
    case "Fit": case "FitB":
      if (dest.length !== 2) return;
      value = { kind }; break;
    case "FitH": case "FitBH":
      if (dest.length !== 3) return;
      value = { kind, top: dest[2] }; break;
    case "FitV": case "FitBV":
      if (dest.length !== 3) return;
      value = { kind, left: dest[2] }; break;
    case "FitR":
      if (dest.length !== 6) return;
      value = { kind, left: dest[2], bottom: dest[3], right: dest[4], top: dest[5] }; break;
    default: return;
  }
  const result = bookmarkDestinationSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function bookmarkDestinationParameters(destination: BookmarkDestination): (string | number | null)[] {
  const parsed = bookmarkDestinationSchema.safeParse(destination);
  if (!parsed.success) throw Error("しおりのページ内移動先が不正です。");
  const d = parsed.data;
  switch (d.kind) {
    case "XYZ": return [d.kind, d.left, d.top, d.zoom];
    case "FitH": case "FitBH": return [d.kind, d.top];
    case "FitV": case "FitBV": return [d.kind, d.left];
    case "FitR": return [d.kind, d.left, d.bottom, d.right, d.top];
    default: return [d.kind];
  }
}
