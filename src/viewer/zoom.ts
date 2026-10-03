export type ZoomMode = "width" | "page" | number;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_PRESETS = Array.from({ length: 16 }, (_, i) => (i + 1) / 4);

export function pageScale(
  page: { width: number; height: number },
  space: { width: number; height: number },
  zoom: ZoomMode,
) {
  if (typeof zoom === "number") return zoom;
  const width = (space.width - 4) / page.width;
  const fit =
    zoom === "width"
      ? width
      : Math.min(width, (space.height - 40) / page.height);
  return Math.max(0.15, Math.min(MAX_ZOOM, fit));
}

export function stepZoom(scale: number, direction: -1 | 1) {
  const next = Math.round((scale + direction * 0.25) * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
}

export function wheelZoom(scale: number, delta: number, mode = 0) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 800 : 1);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
    scale * Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.002),
  ));
}
