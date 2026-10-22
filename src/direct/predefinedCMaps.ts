import names from "./predefinedCMapNames";

/** Read PDF.js's bundled packed CMap assets. The binary format is documented by
 * PDF.js src/core/binary_cmap.js (Apache-2.0). No document-supplied URL is fetched. */
export interface CharacterMap {
  vertical: boolean;
  ranges: { length: number; low: number; high: number }[];
  values: Map<number, number | string>;
  identity?: boolean;
}
const allowed = new Set(names);
const maximum = 262144;
const failure = () => { throw Error("文字コード対応表が不正か、対応範囲を超えています。"); };
class PackedReader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) failure();
  }
  byte() { if (this.at >= this.bytes.length) return failure(); return this.bytes[this.at++]; }
  fixed(size: number) {
    let n = 0n;
    for (let i = 0; i < size; i++) n = n * 256n + BigInt(this.byte());
    return n;
  }
  variable() {
    let n = 0n;
    for (let i = 0; i < 19; i++) {
      const b = this.byte(); n = n * 128n + BigInt(b & 127);
      if (!(b & 128)) return n;
    }
    return failure();
  }
  integer() {
    const n = Number(this.variable());
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) failure();
    return n;
  }
  signed(size?: number) { const raw = this.variable(), n = size ? BigInt.asUintN(size * 8, raw) : raw; return n & 1n ? -(n + 1n) / 2n : n / 2n; }
  string() {
    const count = this.integer(); if (count > 1024) failure();
    let text = "";
    for (let i = 0; i < count; i++) {
      const n = this.integer(); if (n > 65535) failure();
      text += String.fromCharCode(n);
    }
    return text;
  }
}
function byteString(value: bigint, size: number) {
  if (value < 0n || value >= 1n << BigInt(size * 8)) return failure();
  const bytes = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  return String.fromCharCode(...bytes);
}
export function parsePackedCMap(bytes: Uint8Array) {
  const reader = new PackedReader(bytes), header = reader.byte();
  if (header > 5) failure();
  const result: CharacterMap = { vertical: !!(header & 1), ranges: [], values: new Map() };
  let parent: string | undefined, entries = 0;
  const code = (n: bigint) => { if (n < 0n || n > 0xffffffffn) return failure(); return Number(n); };
  const put = (source: bigint, target: number | string) => {
    if (++entries > maximum || result.values.has(code(source))) failure();
    if (typeof target === "number" && (!Number.isInteger(target) || target < 0 || target > 65535)) failure();
    result.values.set(code(source), target);
  };
  const range = (first: bigint, last: bigint, target: bigint, size?: number) => {
    if (last < first || last - first > BigInt(maximum)) failure();
    for (let n = first; n <= last; n++) put(n, size ? byteString(target++, size) : Number(target++));
  };
  while (reader.at < bytes.length) {
    const command = reader.byte(), type = command >> 5, sequence = !!(command & 16), size = (command & 15) + 1;
    if (type === 7) {
      if ((command & 31) === 0) reader.string();
      else if ((command & 31) === 1 && !parent) parent = reader.string();
      else failure();
      continue;
    }
    const count = reader.integer();
    if (!count || count > maximum) failure();
    if (type <= 3 && size > 4) failure();
    if (type <= 1) {
      let end = -1n;
      for (let i = 0; i < count; i++) {
        const start = i ? end + 1n + reader.variable() : reader.fixed(size);
        end = start + reader.variable();
        if (type === 0) {
          if (result.ranges.length >= 256 || end >= 1n << BigInt(size * 8)) failure();
          result.ranges.push({ length: size, low: code(start), high: code(end) });
        } else reader.integer(); // .notdef mappings are deliberately not editable.
      }
    } else if (type === 2 || type === 4) {
      let source = reader.fixed(type === 4 ? 2 : size);
      let target = type === 4 ? reader.fixed(size) : BigInt(reader.integer());
      put(source, type === 4 ? byteString(target, size) : Number(target));
      for (let i = 1; i < count; i++) {
        source += 1n + (sequence ? 0n : reader.variable());
        target = type === 4 ? BigInt.asUintN(size * 8, target + 1n + reader.signed(size)) : target + 1n + reader.signed();
        put(source, type === 4 ? byteString(target, size) : Number(target));
      }
    } else if (type === 3 || type === 5) {
      let end = -1n;
      for (let i = 0; i < count; i++) {
        const start = i ? end + 1n + (sequence ? 0n : reader.variable()) : reader.fixed(type === 5 ? 2 : size);
        end = start + reader.variable();
        const target = type === 5 ? reader.fixed(size) : BigInt(reader.integer());
        range(start, end, target, type === 5 ? size : undefined);
      }
    } else failure();
  }
  return { map: result, parent };
}
const cache = new Map<string, Promise<CharacterMap>>();
async function load(name: string, active: Set<string>): Promise<CharacterMap> {
  if (!allowed.has(name) || active.has(name) || active.size >= 8) return failure();
  const response = await fetch(`/assets/pdfjs/cmaps/${name}.bcmap`);
  if (!response.ok) throw Error("同梱の文字コード対応表を読み込めません。");
  const { map, parent } = parsePackedCMap(new Uint8Array(await response.arrayBuffer()));
  if (parent) {
    const inherited = await load(parent, new Set([...active, name]));
    if (!map.ranges.length) map.ranges = inherited.ranges;
    for (const [code, value] of inherited.values) if (!map.values.has(code)) map.values.set(code, value);
    if (map.values.size > maximum) failure();
  }
  return map;
}
export function predefinedCMap(name: string): Promise<CharacterMap> {
  if (name === "Identity-H" || name === "Identity-V") return Promise.resolve({
    vertical: name === "Identity-V", ranges: [{ length: 2, low: 0, high: 65535 }], values: new Map(), identity: true,
  });
  if (!allowed.has(name)) return Promise.reject(Error("未対応の文字コード対応表です。"));
  let entry = cache.get(name);
  if (!entry) {
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    entry = load(name, new Set());
    cache.set(name, entry);
    const pending = entry;
    void entry.catch(() => { if (cache.get(name) === pending) cache.delete(name); });
  }
  return entry;
}
export function characterCodes(map: CharacterMap, bytes: Uint8Array) {
  const result: { code: number; cid: number; length: number }[] = [];
  for (let at = 0; at < bytes.length;) {
    let code = 0, matched = false;
    for (let length = 1; length <= 4 && at + length <= bytes.length; length++) {
      code = code * 256 + bytes[at + length - 1];
      if (!map.ranges.some(r => r.length === length && code >= r.low && code <= r.high)) continue;
      const cid = map.values.get(code) ?? (map.identity ? code : undefined);
      if (typeof cid !== "number" || !Number.isInteger(cid) || cid < 0 || cid > 65535) return failure();
      result.push({ code, cid, length }); at += length; matched = true; break;
    }
    if (!matched) failure();
  }
  return result;
}
const unicodeDecoder = new TextDecoder("utf-16be", { fatal: true });
export function mappedUnicode(value: number | string | undefined) {
  if (typeof value !== "string" || !value.length || value.length % 2) return undefined;
  try {
    return unicodeDecoder.decode(Uint8Array.from(value, c => c.charCodeAt(0)));
  } catch { return undefined; }
}
