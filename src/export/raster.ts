import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentModel } from "../state/model";
import { exportDocument } from "./client";
import { renderImage } from "./batch";
export async function rasterPage(
  model: DocumentModel,
  index: number,
  format: "png" | "jpeg",
  signal?: AbortSignal,
) {
  const bytes = await exportDocument(
    { ...model, flattenForms: true },
    undefined,
    signal,
    [index],
  );
  const pdf = await getDocument({ data: bytes }).promise;
  try {
    return await renderImage(await pdf.getPage(1), format, 144, 0.94, signal);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
