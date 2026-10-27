import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportDocument } from "../export/client";
import { renderImage } from "../export/batch";
import type { DocumentModel } from "../state/model";
import { withAbort } from "../commands/abort";
import { createImagePptx, type SlideImage } from "./pptx";

export async function exportImagePptx(model: DocumentModel, indices: number[], progress: (n: number, label?: string) => void, signal: AbortSignal): Promise<Uint8Array> {
  if (!indices.length || indices.length > 100) throw Error("PowerPointへの書き出しは1〜100ページまでです。");
  const bytes = await exportDocument({ ...model, flattenForms: true }, n => progress(n * 0.2, "PDFを準備中"), signal, indices);
  const pdf = await getDocument({ data: bytes }).promise;
  const images: SlideImage[] = [];
  let total = 0;
  try {
    for (let i = 0; i < indices.length; i++) {
      if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      const image = await renderImage(page, "jpeg", 144, 0.9, signal);
      total += image.length;
      if (total > 48 * 1024 * 1024) throw Error("ページ画像の合計が48MBを超えました。ページ範囲を減らしてください。");
      images.push({ bytes: image, width: viewport.width, height: viewport.height });
      progress(0.2 + 0.65 * (i + 1) / indices.length, `ページを画像化 ${i + 1} / ${indices.length}`);
    }
    progress(0.9, "PowerPointを作成中");
    return await withAbort(createImagePptx(images), signal);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
