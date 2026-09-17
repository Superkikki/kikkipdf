import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageSize, type DocumentModel } from "../state/model";
import { exportDocument } from "./client";
import { renderImage } from "./batch";
let disposePrevious: (() => void) | undefined;
/** Isolated print DOM: never prints application chrome or the virtualized viewer. */
export async function printPages(
  model: DocumentModel,
  indices: number[],
  dpi: number,
  progress: (n: number, label?: string) => void,
  signal: AbortSignal,
) {
  const pixels = indices.reduce((n, i) => {
    const p = pageSize(model.pages[i]);
    return n + Math.min(20_000_000, p.width * p.height * (dpi / 72) ** 2);
  }, 0);
  if (pixels > 120_000_000)
    throw Error(
      "印刷画像のメモリー上限を超えます。ページ範囲を分けるか、解像度を下げてください。",
    );
  disposePrevious?.();
  const bytes = await exportDocument(
    { ...model, flattenForms: true },
    (n) => progress(n * 0.3, "印刷用PDFを準備中"),
    signal,
    indices,
  );
  const pdf = await getDocument({ data: bytes }).promise;
  const root = document.createElement("div"),
    style = document.createElement("style"),
    urls: string[] = [];
  root.id = "kikki-print-root";
  style.dataset.kikkiPrint = "true";
  const cleanup = () => {
    root.remove();
    style.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
    window.removeEventListener("afterprint", cleanup);
    disposePrevious = undefined;
  };
  disposePrevious = cleanup;
  try {
    for (let i = 0; i < indices.length; i++) {
      const page = await pdf.getPage(i + 1),
        size = page.getViewport({ scale: 1 });
      const bytes = await renderImage(page, "png", dpi, 1, signal);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      urls.push(url);
      const sheet = document.createElement("div"),
        image = document.createElement("img");
      sheet.className = "print-sheet";
      sheet.style.page = `kikki-page-${i}`;
      sheet.style.width = `${size.width}pt`;
      sheet.style.height = `${size.height}pt`;
      style.textContent += `@page kikki-page-${i}{size:${size.width}pt ${size.height}pt;margin:0;}\n`;
      image.src = url;
      image.alt = `ページ ${indices[i] + 1}`;
      await image.decode();
      sheet.append(image);
      root.append(sheet);
      progress(
        0.3 + (0.7 * (i + 1)) / indices.length,
        `印刷を準備 ${i + 1} / ${indices.length}`,
      );
    }
    if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
    document.head.append(style);
    document.body.append(root);
    window.addEventListener("afterprint", cleanup, { once: true });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
