import type { Point } from "../state/model";
export function screenToPage(
  point: Point,
  width: number,
  height: number,
  rotation: number,
  scale: number,
): Point {
  const x = point.x / scale,
    y = point.y / scale;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: y, y: height - x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: width - y, y: x };
    default:
      return { x, y };
  }
}
export const pageToPdf = (
  p: Point,
  height: number,
  origin: Point = { x: 0, y: 0 },
): Point => ({ x: origin.x + p.x, y: origin.y + height - p.y });
