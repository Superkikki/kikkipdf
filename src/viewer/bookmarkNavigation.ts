import type { BookmarkDestination, DocumentModel, PageModel, Point } from "../state/model";
import { pageSize } from "../state/model";
import { sourcePdf } from "./pdf";
import { screenToPage } from "./coordinates";
import { MIN_ZOOM, MAX_ZOOM, type ZoomMode } from "./zoom";

export interface BookmarkNavigation {
  id: string;
  documentId: string;
  pageId: string;
  destination: BookmarkDestination;
}
export interface BookmarkViewport {
  viewBox: number[];
  convertToViewportPoint: (x: number, y: number) => number[];
  convertToPdfPoint: (x: number, y: number) => number[];
}
export async function bookmarkViewport(model: DocumentModel, page: PageModel): Promise<BookmarkViewport> {
  const source = page.sourceId ? model.sources[page.sourceId] : undefined;
  if (source) {
    const pdf = await sourcePdf(source);
    const p = await pdf.getPage(page.sourceIndex + 1);
    return p.getViewport({ scale: 1, rotation: 0 });
  }
  return {
    viewBox: [0, 0, page.width, page.height],
    convertToViewportPoint: (x, y) => [x, page.height - y],
    convertToPdfPoint: (x, y) => [x, page.height - y],
  };
}

/** Convert a point in original PDF user space to the displayed, cropped and rotated page. */
export function bookmarkDisplayPoint(page: PageModel, viewport: BookmarkViewport, left: number, top: number): Point {
  const [vx, vy] = viewport.convertToViewportPoint(left, top);
  const crop = page.crop ?? { x: 0, y: 0, width: page.width, height: page.height };
  const x = vx - crop.x, y = vy - crop.y;
  switch ((page.rotation % 360 + 360) % 360) {
    case 90: return { x: crop.height - y, y: x };
    case 180: return { x: crop.width - x, y: crop.height - y };
    case 270: return { x: y, y: crop.width - x };
    default: return { x, y };
  }
}

export function resolveBookmarkView(
  page: PageModel, viewport: BookmarkViewport, destination: BookmarkDestination,
  space: { width: number; height: number }, currentZoom: ZoomMode,
): { zoom: ZoomMode; point: Point } {
  const clamp = (n: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, n));
  const size = pageSize(page);
  const crop = page.crop ?? { x: 0, y: 0 };
  const [cropLeft, cropTop] = viewport.convertToPdfPoint(crop.x, crop.y);
  switch (destination.kind) {
    case "XYZ": return {
      zoom: destination.zoom ? clamp(destination.zoom) : currentZoom,
      point: bookmarkDisplayPoint(page, viewport, destination.left ?? cropLeft, destination.top ?? cropTop),
    };
    case "FitH": case "FitBH": return {
      zoom: "width", point: bookmarkDisplayPoint(page, viewport, cropLeft, destination.top ?? cropTop),
    };
    case "FitV": case "FitBV": return {
      zoom: clamp((space.height - 40) / size.height),
      point: bookmarkDisplayPoint(page, viewport, destination.left ?? cropLeft, cropTop),
    };
    case "FitR": {
      const a = bookmarkDisplayPoint(page, viewport, destination.left, destination.top);
      const b = bookmarkDisplayPoint(page, viewport, destination.right, destination.bottom);
      return {
        zoom: clamp(Math.min((space.width - 4) / Math.abs(b.x - a.x), (space.height - 40) / Math.abs(b.y - a.y))),
        point: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      };
    }
    default: return { zoom: "page", point: { x: 0, y: 0 } };
  }
}

/** Capture the visible page corner after accounting for crop, rotation and the source CropBox. */
export async function captureBookmarkLocation(model: DocumentModel, active: string): Promise<{ pageId: string; destination: BookmarkDestination }> {
  const page = model.pages.find((p) => p.id === active);
  if (!page) throw Error("しおりのページが見つかりません。");
  const viewport = await bookmarkViewport(model, page);
  const root = document.getElementById("viewer-scroll");
  const view = document.getElementById(`page-${page.id}`)?.querySelector<HTMLElement>(".page-view");
  if (!root || !view) throw Error("ページの表示位置を取得できません。");
  const bounds = view.getBoundingClientRect(), visible = root.getBoundingClientRect();
  const size = pageSize(page), scale = bounds.width / size.width;
  if (!Number.isFinite(scale) || scale <= 0) throw Error("ページの表示倍率を取得できません。");
  const point = screenToPage({
    x: Math.max(0, Math.min(bounds.width, visible.left + root.clientLeft - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, visible.top + root.clientTop - bounds.top)),
  }, page.crop?.width ?? page.width, page.crop?.height ?? page.height, page.rotation, scale);
  const [left, top] = viewport.convertToPdfPoint(point.x + (page.crop?.x ?? 0), point.y + (page.crop?.y ?? 0));
  return { pageId: page.id, destination: { kind: "XYZ", left, top, zoom: scale } };
}
