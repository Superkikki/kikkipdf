import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  PDFHexString,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { unicodeMap } from "./cmap";
import { embeddedCMap } from "./encodingCMap";
import { characterCodes, mappedUnicode, predefinedCMap } from "./predefinedCMaps";
import { glyphUnicode, fontEncoding, standardWidths } from "./simpleFonts";
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
  vertical?: boolean;
  glyphs(
    bytes: Uint8Array,
  ): { code: number; width: number; text: string; extractedText?: string; wordSpace: boolean; vmetric?: [number, number, number] }[];
}
/** Read the ORIGINAL font widths, never substitute them when retaining text advance. */
export async function sourceFonts(
  resources: PDFDict | undefined,
): Promise<Map<string, SourceFont> & { unsupported: Map<string, string> }> {
  const entries = resources?.lookupMaybe(key("Font"), PDFDict)?.entries() ?? [];
  if (entries.length > 4096) throw Error("ページのフォント数が多すぎます。");
  const result = Object.assign(new Map<string, SourceFont>(), { unsupported: new Map<string, string>() });
  for (const [resourceName, ref] of entries) {
    const resource = resourceName.decodeText();
    result.unsupported.set(resource, "このフォントの文字対応・元の文字幅を確認できません。");
    try {
      const dict = resources!.context.lookup(ref, PDFDict);
      const name =
        dict
          .lookupMaybe(key("BaseFont"), PDFName)
          ?.decodeText()
          .replace(/^[A-Z]{6}\+/, "") ?? "";
      const type = dict.lookupMaybe(key("Subtype"), PDFName)?.decodeText();
      result.unsupported.set(resource, `フォント「${name.slice(0, 120) || resource}」（${type ?? "形式不明"}）の文字対応・元の文字幅を確認できません。`);
      const toUnicode = dict.lookup(key("ToUnicode"));
      if (toUnicode && !(toUnicode instanceof PDFRawStream)) continue;
      const map = toUnicode
        ? unicodeMap(boundedDecode(toUnicode, 8 * 1024 * 1024))
        : undefined;
      if (type === "Type0") {
        const encoding = dict.lookup(key("Encoding"));
        const cmap = encoding instanceof PDFName ? await predefinedCMap(encoding.decodeText())
          : encoding instanceof PDFRawStream ? await embeddedCMap(boundedDecode(encoding, 8 * 1024 * 1024),
            encoding.dict.lookupMaybe(key("UseCMap"), PDFName)?.decodeText(),
            encoding.dict.lookupMaybe(key("WMode"), PDFNumber)?.asNumber()) : undefined;
        if (!cmap) continue;
        const vertical = cmap.vertical;
        const descendants = dict.lookup(key("DescendantFonts"), PDFArray),
          descendant = descendants.lookup(0, PDFDict);
        const subtype = descendant.lookup(key("Subtype"), PDFName).decodeText();
        if (!["CIDFontType0", "CIDFontType2"].includes(subtype)) continue;
        const info = descendant.lookupMaybe(key("CIDSystemInfo"), PDFDict);
        const infoText = (name: string) => {
          const value = info?.lookup(key(name));
          return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : undefined;
        };
        const ordering = infoText("Ordering");
        const collection = !map && infoText("Registry") === "Adobe" &&
          ["Japan1", "GB1", "CNS1", "Korea1"].includes(ordering ?? "")
          ? await predefinedCMap(`Adobe-${ordering}-UCS2`) : undefined;
        if (!map && !collection) continue;
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
        const vmetrics = new Map<number, [number, number, number]>();
        let defaultY = 880, defaultAdvance = -1000;
        if (vertical) {
          const dw2 = descendant.lookupMaybe(key("DW2"), PDFArray);
          if (dw2) {
            if (dw2.size() !== 2) continue;
            defaultY = dw2.lookup(0, PDFNumber).asNumber();
            defaultAdvance = dw2.lookup(1, PDFNumber).asNumber();
          }
          const validate = (v: [number, number, number]) => {
            if (!v.every(n => Number.isFinite(n) && Math.abs(n) <= 100000) || v[0] >= 0)
              throw Error("縦書きの文字送り・原点が不正です。");
            return v;
          };
          validate([defaultAdvance, defaultWidth / 2, defaultY]);
          const w2 = descendant.lookupMaybe(key("W2"), PDFArray);
          if (w2 && w2.size() > 200000) continue;
          const put = (cid: number, value: [number, number, number]) => {
            if (vmetrics.has(cid)) throw Error("縦書きの幅情報が重複しています。");
            vmetrics.set(cid, validate(value));
          };
          for (let i = 0; w2 && i < w2.size();) {
            const first = w2.lookup(i++, PDFNumber).asNumber(), next = w2.lookup(i++);
            if (!Number.isInteger(first) || first < 0 || first > 65535) throw Error("縦書きのCID範囲が不正です。");
            if (next instanceof PDFArray) {
              if (next.size() % 3 || first + next.size() / 3 > 65536) throw Error("縦書きの幅情報が不正です。");
              for (let j = 0; j < next.size(); j += 3)
                put(first + j / 3, [next.lookup(j, PDFNumber).asNumber(), next.lookup(j + 1, PDFNumber).asNumber(), next.lookup(j + 2, PDFNumber).asNumber()]);
            } else if (next instanceof PDFNumber) {
              const last = next.asNumber();
              if (!Number.isInteger(last) || last < first || last > 65535) throw Error("縦書きのCID範囲が不正です。");
              const value: [number, number, number] = [w2.lookup(i++, PDFNumber).asNumber(), w2.lookup(i++, PDFNumber).asNumber(), w2.lookup(i++, PDFNumber).asNumber()];
              for (let cid = first; cid <= last; cid++) put(cid, value);
            } else throw Error("縦書きの幅情報が不正です。");
          }
        }
        result.set(resourceName.decodeText(), {
          name, vertical,
          glyphs(bytes) {
            const glyphs = [];
            for (const { code, cid, length } of characterCodes(cmap, bytes)) {
              const text = map ? map.get(code) : mappedUnicode(collection?.values.get(cid));
              if (text === undefined)
                throw Error("文字マップに含まれない文字があります。");
              const width = widths.get(cid) ?? defaultWidth;
              // PDF.js uses DW/2 for the implicit vertical origin. Refuse a
              // differing W entry without explicit W2 rather than guess placement.
              if (vertical && !vmetrics.has(cid) && width !== defaultWidth)
                throw Error("縦書き文字の原点を検証できません。");
              glyphs.push({ code, text, width, wordSpace: length === 1 && code === 32,
                ...(vertical ? { vmetric: vmetrics.get(cid) ?? [defaultAdvance, width / 2, defaultY] as [number, number, number] } : {}),
              });
            }
            return glyphs;
          },
        });
      } else if (type === "Type1" || type === "MMType1" || type === "TrueType") {
        const encoding = dict.lookup(key("Encoding"));
        if (encoding && !(encoding instanceof PDFName) && !(encoding instanceof PDFDict))
          continue;
        const encodingName =
          encoding instanceof PDFName
            ? encoding.decodeText()
            : encoding instanceof PDFDict
              ? encoding.lookupMaybe(key("BaseEncoding"), PDFName)?.decodeText()
              : undefined;
        const first = getNumber(dict, "FirstChar", 0),
          widths = dict.lookupMaybe(key("Widths"), PDFArray);
        const differences = encoding instanceof PDFDict
          ? encoding.lookup(key("Differences"))
          : undefined;
        const descriptor = dict.lookupMaybe(key("FontDescriptor"), PDFDict);
        const embedded = descriptor && ["FontFile", "FontFile2", "FontFile3"].some(name => descriptor.has(key(name)));
        const flags = descriptor?.has(key("Flags")) ? getNumber(descriptor, "Flags") : undefined;
        if (flags !== undefined && (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff)) continue;
        const symbolic = !!((flags ?? 0) & 4) || /Symbol|Dingbats|Wingdings/i.test(name);
        const implicitEncoding = !embedded && !symbolic && type !== "TrueType" ? "StandardEncoding"
          : type === "TrueType" && flags !== undefined && !symbolic
            ? flags & 32 ? "StandardEncoding" : "WinAnsiEncoding" : "";
        const builtin = type === "Type1" && !embedded &&
          Object.values(StandardFonts).includes(name as StandardFonts)
          ? standardWidths(name) : undefined;
        const base = fontEncoding(encodingName ?? (builtin
          ? name === "Symbol" ? "SymbolSetEncoding" : name === "ZapfDingbats"
            ? "ZapfDingbatsEncoding" : "StandardEncoding" : implicitEncoding));
        if (encodingName && !base && !map) continue;
        const glyphNames = base ? [...base] : Array<string>(256).fill("");
        if (differences) {
          if (!(differences instanceof PDFArray) || differences.size() > 512)
            continue;
          let code: number | undefined;
          const used = new Set<number>();
          for (const entry of differences.asArray()) {
            if (entry instanceof PDFNumber) {
              code = entry.asNumber();
              if (!Number.isInteger(code) || code < 0 || code > 255)
                throw Error("独自エンコーディングの文字コードが不正です。");
            } else if (entry instanceof PDFName && code !== undefined && code <= 255) {
              if (used.has(code)) throw Error("独自エンコーディングの文字コードが重複しています。");
              used.add(code);
              glyphNames[code++] = entry.decodeText();
            } else throw Error("独自エンコーディングの形式が不正です。");
          }
        }
        if (
          !Number.isInteger(first) ||
          first < 0 ||
          first > 255 ||
          (widths && first + widths.size() > 256)
        )
          continue;
        if (!widths && !builtin) continue;
        if (!base && !differences && !map) continue;
        result.set(resourceName.decodeText(), {
          name,
          glyphs(bytes) {
            return Array.from(bytes, (code) => {
              const glyphName = glyphNames[code];
              const text = map ? map.get(code) : glyphUnicode(glyphName);
              if (text === undefined || !text)
                throw Error("文字コードに対応するUnicodeを検証できません。");
              if (widths && (code < first || code - first >= widths.size()))
                throw Error("文字コードに対応する幅情報がありません。");
              const width = widths
                ? widths.lookup(code - first, PDFNumber).asNumber()
                : builtin && Object.hasOwn(builtin, glyphName) ? builtin[glyphName] : NaN;
              if (!Number.isFinite(width) || width < 0 || width > 100000)
                throw Error("文字幅が不正です。");
              return { code, text, width, wordSpace: code === 32,
                // PDF.js falls back to the byte value for unnamed Dingbats
                // Unicode extraction, even though the rendered glyph is known.
                ...(!map && name === "ZapfDingbats" && /^a[0-9]+$/.test(glyphName)
                  ? { extractedText: String.fromCharCode(code) } : {}),
              };
            });
          },
        });
      }
    } catch (error) {
      if (error instanceof Error) result.unsupported.set(resource,
        `${result.unsupported.get(resource)} ${error.message}`);
    }
  }
  for (const resource of result.keys()) result.unsupported.delete(resource);
  return result;
}
