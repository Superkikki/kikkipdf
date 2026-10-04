import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { comparePixels, type PixelDifference } from "./pixels";

export interface CompareOptions { threshold?: number; dpi?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
export interface ComparedPage extends PixelDifference {
  index: number; status: "same" | "changed" | "added" | "removed"; sizeChanged: boolean;
  width: number; height: number; scale: number;
  leftSize: { width: number; height: number } | null;
  rightSize: { width: number; height: number } | null;
}
export const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("比較を中止しました", "AbortError"); };

export async function renderPair(left: PDFDocumentProxy, right: PDFDocumentProxy, index: number, options: CompareOptions = {}) {
  checkAbort(options.signal);
  if (!Number.isInteger(index) || index < 0 || index >= Math.max(left.numPages, right.numPages) || left.numPages > 500 || right.numPages > 500) throw new Error("PDF比較は各文書500ページまでです。");
  const dpi = options.dpi ?? 72;
  if (dpi !== 72 && dpi !== 144) throw new Error("比較解像度が不正です。");
  const pages: (PDFPageProxy | null)[] = [];
  const canvases: HTMLCanvasElement[] = [];
  try {
    pages.push(index < left.numPages ? await left.getPage(index + 1) : null);
    pages.push(index < right.numPages ? await right.getPage(index + 1) : null);
    checkAbort(options.signal);
    const sizes = pages.map(page => { const v = page?.getViewport({ scale: 1 }); return v ? { width: v.width, height: v.height } : null; });
    const physicalWidth = Math.max(...sizes.map(s => s?.width ?? 0)), physicalHeight = Math.max(...sizes.map(s => s?.height ?? 0));
    if (!Number.isFinite(physicalWidth) || !Number.isFinite(physicalHeight) || physicalWidth <= 0 || physicalHeight <= 0) throw new Error("ページ寸法が不正です。");
    // Reserve rounding headroom so ceil(width) * ceil(height) stays under the limit.
    const scale = Math.min(dpi / 72, 4095 / physicalWidth, 4095 / physicalHeight, Math.sqrt(1_990_000 / (physicalWidth * physicalHeight)));
    const width = Math.max(1, Math.ceil(physicalWidth * scale)), height = Math.max(1, Math.ceil(physicalHeight * scale));
    for (const page of pages) {
      checkAbort(options.signal);
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; canvases.push(canvas);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("比較画像を作成できません。");
      context.fillStyle = "white"; context.fillRect(0, 0, width, height);
      if (page) {
        const task = page.render({ canvas, viewport: page.getViewport({ scale }), background: "white" });
        const abort = () => task.cancel(); options.signal?.addEventListener("abort", abort, { once: true });
        try { await task.promise; } finally { options.signal?.removeEventListener("abort", abort); }
      }
    }
    checkAbort(options.signal);
    const pixels = canvases.map(c => c.getContext("2d")!.getImageData(0, 0, width, height).data);
    const difference = comparePixels(pixels[0], pixels[1], width, height, options.threshold);
    const sizeChanged = !!sizes[0] && !!sizes[1] && (Math.abs(sizes[0].width - sizes[1].width) > .1 || Math.abs(sizes[0].height - sizes[1].height) > .1);
    const result: ComparedPage = { ...difference, index, width, height, scale, leftSize: sizes[0], rightSize: sizes[1], sizeChanged,
      status: !pages[0] ? "added" : !pages[1] ? "removed" : sizeChanged || difference.changedPixels ? "changed" : "same" };
    return { result, pixels };
  } finally {
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    for (const page of pages) page?.cleanup();
  }
}

export async function comparePdfs(left: PDFDocumentProxy, right: PDFDocumentProxy, options: CompareOptions = {}): Promise<ComparedPage[]> {
  if (left.numPages > 500 || right.numPages > 500) throw new Error("PDF比較は各文書500ページまでです。");
  const total = Math.max(left.numPages, right.numPages), results: ComparedPage[] = [];
  for (let index = 0; index < total; index++) {
    checkAbort(options.signal);
    results.push((await renderPair(left, right, index, options)).result);
    options.onProgress?.(index + 1, total);
    // Allow cancellation and progress painting between pages.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  checkAbort(options.signal);
  return results;
}
