import {
  getDocument,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentModel } from "../state/model";
import { exportDocument, exportZip } from "./client";

export async function renderImage(
  page: PDFPageProxy,
  format: "png" | "jpeg",
  dpi: number,
  quality: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(
      dpi / 72,
      Math.sqrt(20_000_000 / (natural.width * natural.height)),
    ),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const task = page.render({
    canvas,
    viewport,
    background: "rgb(255,255,255)",
  });
  const abort = () => task.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await task.promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error("画像を書き出せません。"))),
        `image/${format}`,
        quality,
      ),
    );
    if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
    return new Uint8Array(await blob.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) throw new DOMException("キャンセル", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    canvas.width = canvas.height = 0;
    page.cleanup();
  }
}

export async function exportPageImages(
  model: DocumentModel,
  indices: number[],
  format: "png" | "jpeg",
  dpi: number,
  quality: number,
  progress: (n: number, label?: string) => void,
  signal: AbortSignal,
) {
  const bytes = await exportDocument(
    { ...model, flattenForms: true },
    (n) => progress(n * 0.25, "PDFを準備中"),
    signal,
    indices,
  );
  const pdf = await getDocument({ data: bytes }).promise,
    files: Record<string, Uint8Array> = {};
  let total = 0;
  try {
    for (let i = 0; i < indices.length; i++) {
      const image = await renderImage(
        await pdf.getPage(i + 1),
        format,
        dpi,
        quality,
        signal,
      );
      total += image.length;
      if (total > 512 * 1024 * 1024)
        throw Error(
          "画像の合計が512MBを超えました。ページ範囲または解像度を小さくしてください。",
        );
      files[
        `page-${String(indices[i] + 1).padStart(4, "0")}.${format === "jpeg" ? "jpg" : "png"}`
      ] = image;
      progress(
        0.25 + (0.65 * (i + 1)) / indices.length,
        `画像化 ${i + 1} / ${indices.length}`,
      );
    }
    progress(0.95, "ZIPを作成中");
    return await exportZip(files, signal);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export async function exportText(
  model: DocumentModel,
  indices: number[],
  progress: (n: number) => void,
  signal: AbortSignal,
) {
  const bytes = await exportDocument(
    { ...model, flattenForms: true },
    undefined,
    signal,
    indices,
  );
  const pdf = await getDocument({ data: bytes }).promise,
    parts: string[] = [];
  try {
    for (let i = 0; i < indices.length; i++) {
      if (signal.aborted) throw new DOMException("キャンセル", "AbortError");
      const page = await pdf.getPage(i + 1),
        content = await page.getTextContent();
      parts.push(
        `--- ページ ${indices[i] + 1} ---\n` +
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join(""),
      );
      page.cleanup();
      progress((i + 1) / indices.length);
    }
    return new TextEncoder().encode(parts.join("\n\n"));
  } finally {
    await pdf.loadingTask.destroy();
  }
}
