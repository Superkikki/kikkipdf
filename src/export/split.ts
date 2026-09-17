import { zipSync } from "fflate";
import type { DocumentModel } from "../state/model";
import { exportPdf } from "./engine";

/** Worker-only split: one model transfer, bounded archive, one native save dialog. */
export async function splitPdfZip(
  model: DocumentModel,
  indices: number[],
  groupSize: number,
  fontBytes?: Uint8Array,
  progress: (n: number) => void = () => {},
) {
  if (
    !indices.length ||
    !Number.isInteger(groupSize) ||
    groupSize < 1 ||
    groupSize > model.pages.length ||
    indices.some(
      (n) => !Number.isInteger(n) || n < 0 || n >= model.pages.length,
    )
  )
    throw Error("分割するページ数または範囲が不正です。");
  if (model.pages.some((p) => p.objects.some((o) => o.kind === "redaction")))
    throw Error("墨消し候補を適用してから分割してください。");
  const files: Record<string, Uint8Array> = {},
    count = Math.ceil(indices.length / groupSize);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const range = indices.slice(i * groupSize, (i + 1) * groupSize);
    const bytes = await exportPdf(model, fontBytes, { indices: range }, (n) =>
      progress(((i + n) / count) * 0.95),
    );
    total += bytes.length;
    if (total > 256 * 1024 * 1024)
      throw Error(
        "分割PDFの合計が256MBを超えました。範囲を分けて出力してください。",
      );
    files[`part-${String(i + 1).padStart(4, "0")}.pdf`] = bytes;
  }
  const archive = zipSync(files, { level: 0 });
  progress(1);
  return archive;
}
