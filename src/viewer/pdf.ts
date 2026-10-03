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
  type ImageAsset,
  type Source,
  type PageModel,
} from "../state/model";
import type { LocalFile } from "../platform/files";
import { previewDirectPage } from "../export/client";
import { directReferences, directImageEdits } from "../direct/model";
GlobalWorkerOptions.workerSrc = workerUrl;
const cache = new Map<string, Promise<PDFDocumentProxy>>();
interface PageLease {
  ready: Promise<{ pdf: PDFDocumentProxy; index: number }>;
  release(): void;
}
const previews = new Map<
  string,
  { users: number; ready: PageLease["ready"]; controller: AbortController }
>();
/** Share previews only while a visible viewer, thumbnail or search holds a lease. */
export function acquirePagePdf(source: Source, page: PageModel, assets: Record<string, ImageAsset> = {}): PageLease {
  const refs = directReferences(page), images = directImageEdits(page);
  if (!refs.length && !images.length)
    return {
      ready: sourcePdf(source).then((pdf) => ({
        pdf,
        index: page.sourceIndex,
      })),
      release() {},
    };
  const key = `${source.id}:${page.sourceIndex}:${JSON.stringify({ refs, images })}`;
  let entry = previews.get(key);
  if (!entry) {
    const controller = new AbortController();
    const ready = previewDirectPage(
      source,
      {
        ...page,
        objects: page.objects.filter((o) => o.kind === "direct-text" || o.kind === "direct-image"),
      },
      controller.signal,
      Object.fromEntries(images.filter(edit => !edit.deleted && edit.imageId).map(edit => [edit.imageId!, assets[edit.imageId!]])),
    ).then(async (bytes) => ({
      pdf: await getDocument({
        data: bytes,
        cMapUrl: "/assets/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
        wasmUrl: "/assets/pdfjs/wasm/",
      }).promise,
      index: 0,
    }));
    ready.catch(() => {});
    entry = { ready, controller, users: 0 };
    previews.set(key, entry);
  }
  entry.users++;
  const captured = entry;
  let released = false;
  return {
    ready: entry.ready,
    release() {
      if (released) return;
      released = true;
      if (--captured.users === 0) {
        if (previews.get(key) === captured) previews.delete(key);
        captured.controller.abort();
        void captured.ready
          .then(({ pdf }) => pdf.loadingTask.destroy())
          .catch(() => {});
      }
    },
  };
}
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
  for (const entry of previews.values()) {
    entry.controller.abort();
    void entry.ready
      .then(({ pdf }) => pdf.loadingTask.destroy())
      .catch(() => {});
  }
  previews.clear();
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
