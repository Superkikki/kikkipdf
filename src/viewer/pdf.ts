import { readBookmarks } from "../pages/bookmarks";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  emptyDocument,
  uid,
  type DocumentModel,
  type Source,
} from "../state/model";
import type { LocalFile } from "../platform/files";
GlobalWorkerOptions.workerSrc = workerUrl;
const cache = new Map<string, Promise<PDFDocumentProxy>>();
export function sourcePdf(source: Source): Promise<PDFDocumentProxy> {
  let p = cache.get(source.id);
  if (!p) {
    p = getDocument({
      data: source.bytes.slice(),
      cMapUrl: "/assets/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
      wasmUrl: "/assets/pdfjs/wasm/",
    }).promise;
    cache.set(source.id, p);
  }
  return p;
}
export async function releasePdfs() {
  for (const p of cache.values())
    void p.then((d) => d.loadingTask.destroy()).catch(() => {});
  cache.clear();
}
export async function importPdf(
  file: LocalFile,
  progress: (n: number) => void = () => {},
): Promise<DocumentModel> {
  const id = uid();
  const source: Source = { id, name: file.name, bytes: file.bytes };
  const pdf = await sourcePdf(source);
  const model = emptyDocument(file.name);
  model.path = file.path;
  model.sources[id] = source;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const v = page.getViewport({ scale: 1, rotation: 0 });
    model.pages.push({
      id: uid(),
      sourceId: id,
      sourceIndex: i - 1,
      width: v.width,
      height: v.height,
      rotation: page.rotate,
      objects: [],
    });
    if (i % 10 === 0) {
      progress(i / pdf.numPages);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  model.bookmarks = await readBookmarks(pdf, model.pages).catch(() => []);
  const info = (await pdf.getMetadata()).info as Record<string, unknown>;
  model.metadata = {
    title: String(info.Title ?? ""),
    author: String(info.Author ?? ""),
    subject: String(info.Subject ?? ""),
    keywords: String(info.Keywords ?? ""),
  };
  return model;
}
