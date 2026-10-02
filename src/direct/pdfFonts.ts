import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { unicodeMap } from "./cmap";
const key = (name: string) => PDFName.of(name);
export function boundedDecode(
  stream: PDFRawStream,
  maximum = 64 * 1024 * 1024,
) {
  const data = decodePDFRawStream(stream).getBytes(maximum + 1);
  if (data.length > maximum)
    throw Error("描画命令の展開サイズが上限を超えています。");
  return new Uint8Array(data);
}
const getNumber = (dict: PDFDict, name: string, fallback?: number) => {
  const n = dict.lookupMaybe(key(name), PDFNumber)?.asNumber() ?? fallback;
  if (n === undefined || !Number.isFinite(n))
    throw Error("フォントの幅情報が不正です。");
  return n;
};
export interface SourceFont {
  name: string;
  glyphs(
    bytes: Uint8Array,
  ): { code: number; width: number; text: string; wordSpace: boolean }[];
}
/** Read the ORIGINAL font widths, never substitute them when retaining text advance. */
export async function sourceFonts(
  resources: PDFDict | undefined,
): Promise<Map<string, SourceFont>> {
  const entries = resources?.lookupMaybe(key("Font"), PDFDict)?.entries() ?? [];
  if (entries.length > 4096) throw Error("ページのフォント数が多すぎます。");
  const result = new Map<string, SourceFont>(),
    metrics = await PDFDocument.create();
  for (const [resourceName, ref] of entries) {
    try {
      const dict = resources!.context.lookup(ref, PDFDict);
      const name =
        dict
          .lookupMaybe(key("BaseFont"), PDFName)
          ?.decodeText()
          .replace(/^[A-Z]{6}\+/, "") ?? "";
      const type = dict.lookupMaybe(key("Subtype"), PDFName)?.decodeText();
      const toUnicode = dict.lookup(key("ToUnicode"));
      if (toUnicode && !(toUnicode instanceof PDFRawStream)) continue;
      const map = toUnicode
        ? unicodeMap(boundedDecode(toUnicode, 8 * 1024 * 1024))
        : undefined;
      if (type === "Type0") {
        if (
          dict.lookupMaybe(key("Encoding"), PDFName)?.decodeText() !==
            "Identity-H" ||
          !map
        )
          continue;
        const descendants = dict.lookup(key("DescendantFonts"), PDFArray),
          descendant = descendants.lookup(0, PDFDict);
        const subtype = descendant.lookup(key("Subtype"), PDFName).decodeText();
        if (!["CIDFontType0", "CIDFontType2"].includes(subtype)) continue;
        const defaultWidth = getNumber(descendant, "DW", 1000),
          widths = new Map<number, number>();
        const w = descendant.lookupMaybe(key("W"), PDFArray);
        if (w && w.size() > 131072) continue;
        for (let i = 0; w && i < w.size(); ) {
          const first = w.lookup(i++, PDFNumber).asNumber(),
            next = w.lookup(i++);
          if (!Number.isInteger(first) || first < 0 || first > 65535)
            throw Error("CID範囲が不正です。");
          if (next instanceof PDFArray) {
            if (first + next.size() > 65536) throw Error("CID範囲が不正です。");
            for (let j = 0; j < next.size(); j++) {
              if (widths.has(first + j))
                throw Error("CID幅の範囲が重複しています。");
              widths.set(first + j, next.lookup(j, PDFNumber).asNumber());
            }
          } else if (next instanceof PDFNumber) {
            const last = next.asNumber(),
              width = w.lookup(i++, PDFNumber).asNumber();
            if (!Number.isInteger(last) || last < first || last > 65535)
              throw Error("CID範囲が不正です。");
            for (let c = first; c <= last; c++) {
              if (widths.has(c)) throw Error("CID幅の範囲が重複しています。");
              widths.set(c, width);
            }
          } else throw Error("CID幅情報が不正です。");
        }
        if (
          ![defaultWidth, ...widths.values()].every(
            (n) => Number.isFinite(n) && n >= 0 && n <= 100000,
          )
        )
          continue;
        result.set(resourceName.decodeText(), {
          name,
          glyphs(bytes) {
            if (bytes.length % 2) throw Error("2バイト文字コードが不正です。");
            const glyphs = [];
            for (let i = 0; i < bytes.length; i += 2) {
              const code = bytes[i] * 256 + bytes[i + 1],
                text = map.get(code);
              if (text === undefined)
                throw Error("文字マップに含まれない文字があります。");
              glyphs.push({
                code,
                text,
                width: widths.get(code) ?? defaultWidth,
                wordSpace: false,
              });
            }
            return glyphs;
          },
        });
      } else if (type === "Type1" || type === "TrueType") {
        const encoding = dict.lookup(key("Encoding"));
        const encodingName =
          encoding instanceof PDFName
            ? encoding.decodeText()
            : encoding instanceof PDFDict
              ? encoding.lookupMaybe(key("BaseEncoding"), PDFName)?.decodeText()
              : undefined;
        if (
          encodingName &&
          !["WinAnsiEncoding", "StandardEncoding"].includes(encodingName)
        )
          continue;
        if (encoding instanceof PDFDict && encoding.has(key("Differences")))
          continue;
        const first = getNumber(dict, "FirstChar", 0),
          widths = dict.lookupMaybe(key("Widths"), PDFArray);
        if (
          !Number.isInteger(first) ||
          first < 0 ||
          first > 255 ||
          (widths && first + widths.size() > 256)
        )
          continue;
        const builtin =
          type === "Type1" &&
          !dict.has(key("FontDescriptor")) &&
          Object.values(StandardFonts).includes(name as StandardFonts) &&
          !["Symbol", "ZapfDingbats"].includes(name)
            ? await metrics.embedFont(name as StandardFonts)
            : undefined;
        if (!widths && !builtin) continue;
        const decoder = new TextDecoder("windows-1252");
        result.set(resourceName.decodeText(), {
          name,
          glyphs(bytes) {
            return Array.from(bytes, (code) => {
              if (encodingName !== "WinAnsiEncoding" && code > 126)
                throw Error("標準エンコーディングの非ASCII文字は未対応です。");
              const glyphText = decoder.decode(new Uint8Array([code]));
              const text = map?.get(code) ?? glyphText;
              const width = widths
                ? widths.lookup(code - first, PDFNumber).asNumber()
                : builtin!.widthOfTextAtSize(glyphText, 1000);
              if (!Number.isFinite(width) || width < 0 || width > 100000)
                throw Error("文字幅が不正です。");
              return { code, text, width, wordSpace: code === 32 };
            });
          },
        });
      }
    } catch {
      /* Unsupported fonts are excluded; no guessed metrics enter direct edits. */
    }
  }
  return result;
}
