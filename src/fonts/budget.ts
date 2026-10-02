import type { FontAsset } from "../state/model";
export const MAX_FONT_BYTES = 32 * 1024 * 1024;
export function checkFontBudget(fonts: Record<string, FontAsset>) {
  const assets = Object.values(fonts);
  if (
    assets.some((f) => f.bytes.length > MAX_FONT_BYTES) ||
    assets.length > 32 ||
    assets.reduce((n, f) => n + f.bytes.length, 0) > 128 * 1024 * 1024
  )
    throw Error("登録フォントは1件32MB・32件・合計128MBまでです。");
}
