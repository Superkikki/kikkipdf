import fontkit from "@pdf-lib/fontkit";
import type { FontAsset } from "../state/model";

import { MAX_FONT_BYTES } from "./budget";
/** Parse only static SFNT outlines. Never install fonts on the operating system.
 * fsType is checked before fontkit parses data; permissions are never rewritten.
 */
export async function inspectFont(
  bytes: Uint8Array,
  name: string,
): Promise<FontAsset> {
  if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES)
    throw Error("フォントは1件32MBまでのTTF／OTFを指定してください。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f)
    throw Error(
      "静的なTTF／OTFのみ対応しています。TTC・WOFF・可変フォントは未対応です。",
    );
  const count = view.getUint16(4),
    end = 12 + count * 16;
  if (!count || count > 256 || end > bytes.length)
    throw Error("フォントのテーブル情報が不正です。");
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const start = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(start, start + 4));
    const offset = view.getUint32(start + 8),
      length = view.getUint32(start + 12);
    if (tables.has(tag) || offset < end || offset + length > bytes.length)
      throw Error("フォントのテーブル範囲が不正です。");
    if (
      length &&
      [...tables.values()].some(
        (t) =>
          t.length &&
          offset < t.offset + t.length &&
          t.offset < offset + length,
      )
    )
      throw Error("フォントのテーブル範囲が重複しています。");
    tables.set(tag, { offset, length });
  }
  if (
    ["fvar", "CFF2", "COLR", "CBDT", "sbix", "SVG "].some((tag) =>
      tables.has(tag),
    )
  )
    throw Error(
      "可変・カラーフォントは未対応です。静的なアウトラインフォントを指定してください。",
    );
  const required = [
    "head",
    "maxp",
    "name",
    "cmap",
    "hhea",
    "hmtx",
    "OS/2",
    ...(signature === 0x4f54544f ? ["CFF "] : ["glyf", "loca"]),
  ];
  if (required.some((tag) => !tables.has(tag)))
    throw Error("必要なフォントテーブルがありません。");
  const os2 = tables.get("OS/2")!;
  if (os2.length < 10) throw Error("フォントの埋め込み権限情報が不正です。");
  const version = view.getUint16(os2.offset),
    flags = view.getUint16(os2.offset + 8);
  const permission = flags & 15;
  // Older OS/2 versions permit multiple permission bits (least restrictive wins).
  const editable = permission === 0 || (permission & 8) !== 0;
  if (permission & 1 || (version >= 3 && ![0, 2, 4, 8].includes(permission)))
    throw Error("フォントの埋め込み権限を判定できません。");
  if (!editable || (version >= 2 && flags & 0x200))
    throw Error(
      "このフォントは編集用のアウトライン埋め込みを許可していません。",
    );
  try {
    const font = fontkit.create(bytes);
    if (!font.numGlyphs || !font.unitsPerEm || !font.characterSet.length)
      throw Error("文字情報がありません。");
    // Force basic outline/metrics decoding before accepting an asset.
    font.layout("Aa 012").glyphs.forEach((glyph) => {
      void glyph.path.toSVG();
    });
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const hash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return {
      id: `font-${hash}`,
      name: name.slice(0, 1000),
      family: (font.fullName || font.familyName || name).slice(0, 1000),
      format: signature === 0x4f54544f ? "otf" : "ttf",
      bytes,
    };
  } catch (error) {
    throw Error(
      `フォントを読み込めません: ${error instanceof Error ? error.message : "データが不正です"}`,
    );
  }
}
