export interface DifferenceRegion { x: number; y: number; width: number; height: number }
export interface PixelDifference { changedPixels: number; ratio: number; regions: DifferenceRegion[] }

/** Composite transparency over the same white paper used by the PDF renderer. */
export function pixelChanged(left: Uint8ClampedArray, right: Uint8ClampedArray, offset: number, threshold: number) {
  const a = left[offset + 3] / 255, b = right[offset + 3] / 255;
  for (let c = 0; c < 3; c++) {
    if (Math.abs(left[offset + c] * a + 255 * (1 - a) - right[offset + c] * b - 255 * (1 - b)) > threshold) return true;
  }
  return false;
}

export function comparePixels(left: Uint8ClampedArray, right: Uint8ClampedArray, width: number, height: number, threshold = 24): PixelDifference {
  if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 4096) || width * height > 2_000_000 ||
    left.length !== width * height * 4 || right.length !== left.length || !Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error("比較画像の寸法・データ・感度が不正です。");
  }
  const columns = Math.ceil(width / 16), rows = Math.ceil(height / 16);
  const tiles = new Uint8Array(columns * rows);
  let changedPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixelChanged(left, right, (y * width + x) * 4, threshold)) {
      changedPixels++;
      tiles[Math.floor(y / 16) * columns + Math.floor(x / 16)] = 1;
    }
  }
  const regions: DifferenceRegion[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (!tiles[start]) continue;
    const queue = [start]; tiles[start] = 0;
    let minX = columns, minY = rows, maxX = 0, maxY = 0;
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % columns, y = Math.floor(queue[i] / columns);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, index = ny * columns + nx;
        if (nx >= 0 && ny >= 0 && nx < columns && ny < rows && tiles[index]) { tiles[index] = 0; queue.push(index); }
      }
    }
    regions.push({ x: minX * 16, y: minY * 16, width: Math.min(width, (maxX + 1) * 16) - minX * 16, height: Math.min(height, (maxY + 1) * 16) - minY * 16 });
  }
  regions.sort((a, b) => b.width * b.height - a.width * a.height || a.y - b.y || a.x - b.x);
  return { changedPixels, ratio: changedPixels / (width * height), regions: regions.slice(0, 200) };
}
