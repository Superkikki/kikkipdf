export type Operand =
  | number
  | boolean
  | null
  | Uint8Array
  | { name: string }
  | Operand[]
  | Map<string, Operand>;
export interface Operation {
  operator: string;
  args: Operand[];
  start: number;
  end: number;
}
const white = (b: number) => [0, 9, 10, 12, 13, 32].includes(b);
const delimiter = (b: number) =>
  white(b) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(b);
/** Bounded PDF content/CMap lexer. Offsets always refer to original bytes.
 * Inline images with verifiable byte boundaries are kept as opaque operations.
 */
export function parseContent(bytes: Uint8Array): Operation[] {
  if (bytes.length > 64 * 1024 * 1024)
    throw Error("ページの描画命令は展開後64MBまで対応しています。");
  let at = 0,
    tokens = 0;
  const fail = () => {
    throw Error("PDFの描画命令を安全に解析できません。");
  };
  function skip() {
    while (at < bytes.length) {
      if (white(bytes[at])) at++;
      else if (bytes[at] === 37) {
        while (at < bytes.length && ![10, 13].includes(bytes[at])) at++;
      } else break;
    }
  }
  function word() {
    const start = at;
    while (at < bytes.length && !delimiter(bytes[at])) at++;
    if (at === start || at - start > 1000) return fail();
    return String.fromCharCode(...bytes.subarray(start, at));
  }
  function value(depth = 0): Operand | { operator: string } {
    if (depth > 32 || ++tokens > 1_000_000) return fail();
    skip();
    const b = bytes[at++];
    if (b === 47) {
      const start = at;
      while (at < bytes.length && !delimiter(bytes[at])) at++;
      if (at - start > 1000) return fail();
      const name = String.fromCharCode(...bytes.subarray(start, at)).replace(
        /#([a-f\d]{2})/gi,
        (_, n: string) => String.fromCharCode(parseInt(n, 16)),
      );
      return { name };
    }
    if (b === 40) {
      const data: number[] = [];
      let nest = 1;
      while (at < bytes.length && nest) {
        const c = bytes[at++];
        if (c === 92) {
          if (at >= bytes.length) return fail();
          const next = bytes[at++];
          if (next === 13 || next === 10) {
            if (next === 13 && bytes[at] === 10) at++;
            continue;
          }
          const escapes: Record<number, number> = {
            110: 10,
            114: 13,
            116: 9,
            98: 8,
            102: 12,
          };
          if (next >= 48 && next <= 55) {
            let octal = next - 48;
            for (let i = 0; i < 2 && bytes[at] >= 48 && bytes[at] <= 55; i++)
              octal = octal * 8 + bytes[at++] - 48;
            data.push(octal & 255);
          } else data.push(escapes[next] ?? next);
        } else if (c === 40) {
          nest++;
          data.push(c);
        } else if (c === 41) {
          if (--nest) data.push(c);
        } else if (c === 13) {
          data.push(10);
          if (bytes[at] === 10) at++;
        } else data.push(c);
        if (data.length > 4 * 1024 * 1024) return fail();
      }
      if (nest) return fail();
      return new Uint8Array(data);
    }
    if (b === 60 && bytes[at] !== 60) {
      let hex = "";
      while (at < bytes.length && bytes[at] !== 62) {
        const c = bytes[at++];
        if (!white(c)) hex += String.fromCharCode(c);
        if (hex.length > 8 * 1024 * 1024) return fail();
      }
      if (bytes[at++] !== 62 || !/^[a-f\d]*$/i.test(hex)) return fail();
      if (hex.length % 2) hex += "0";
      return Uint8Array.from({ length: hex.length / 2 }, (_, i) =>
        parseInt(hex.slice(i * 2, i * 2 + 2), 16),
      );
    }
    if (b === 91) {
      const array: Operand[] = [];
      skip();
      while (at < bytes.length && bytes[at] !== 93) {
        const v = value(depth + 1);
        if (isOperator(v)) return fail();
        array.push(v);
        skip();
      }
      if (bytes[at++] !== 93) return fail();
      return array;
    }
    if (b === 60 && bytes[at++] === 60) {
      const map = new Map<string, Operand>();
      skip();
      while (at < bytes.length && !(bytes[at] === 62 && bytes[at + 1] === 62)) {
        const key = value(depth + 1),
          v = value(depth + 1);
        if (!isName(key) || isOperator(v) || map.has(key.name)) return fail();
        map.set(key.name, v);
        skip();
      }
      if (bytes[at++] !== 62 || bytes[at++] !== 62) return fail();
      return map;
    }
    at--;
    const token = word();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const n = Number(token);
      if (!Number.isFinite(n) || Math.abs(n) > 1e10) return fail();
      return n;
    }
    if (token === "true" || token === "false") return token === "true";
    if (token === "null") return null;
    return { operator: token };
  }
  const operations: Operation[] = [];
  let args: Operand[] = [],
    start = 0;
  skip();
  start = at;
  while (at < bytes.length) {
    const v = value();
    if (isOperator(v)) {
      if (v.operator === "BI") {
        if (args.length) fail();
        const parameters = new Map<string, Operand>();
        while (at < bytes.length) {
          const key = value();
          if (isOperator(key) && key.operator === "ID") break;
          if (!isName(key) || parameters.has(key.name)) fail();
          const item = value();
          if (isOperator(item)) fail();
          parameters.set((key as { name: string }).name, item as Operand);
        }
        if (!white(bytes[at])) fail();
        if (bytes[at++] === 13 && bytes[at] === 10) at++;
        const dataStart = at;
        const filter = parameters.get("F") ?? parameters.get("Filter");
        const outer = Array.isArray(filter) ? filter[0] : filter;
        if (filter === undefined) {
          const width = parameters.get("W") ?? parameters.get("Width"), height = parameters.get("H") ?? parameters.get("Height");
          const mask = parameters.get("IM") ?? parameters.get("ImageMask");
          const bits = parameters.get("BPC") ?? parameters.get("BitsPerComponent") ?? (mask === true ? 1 : undefined);
          const color = parameters.get("CS") ?? parameters.get("ColorSpace");
          const name = isName(color) ? color.name : Array.isArray(color) && isName(color[0]) ? color[0].name : "";
          const components = mask === true || ["G", "DeviceGray", "I", "Indexed"].includes(name) ? 1
            : ["RGB", "DeviceRGB"].includes(name) ? 3 : ["CMYK", "DeviceCMYK"].includes(name) ? 4 : 0;
          if (typeof width !== "number" || typeof height !== "number" || typeof bits !== "number" ||
              !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
              width > 16384 || height > 16384 || ![1, 2, 4, 8, 16].includes(bits) || !components) fail();
          const length = Math.ceil((width as number) * (bits as number) * components / 8) * (height as number);
          if (length > 64 * 1024 * 1024 || at + length > bytes.length) fail();
          at += length;
        } else if (isName(outer) && ["AHx", "ASCIIHexDecode"].includes(outer.name)) {
          while (at < bytes.length && bytes[at] !== 62) {
            const b = bytes[at++];
            if (!white(b) && !((b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102))) fail();
          }
          if (bytes[at++] !== 62) fail();
        } else if (isName(outer) && ["A85", "ASCII85Decode"].includes(outer.name)) {
          while (at < bytes.length && !(bytes[at] === 126 && bytes[at + 1] === 62)) {
            const b = bytes[at++];
            if (!white(b) && !(b >= 33 && b <= 117) && b !== 122) fail();
          }
          if (bytes[at++] !== 126 || bytes[at++] !== 62) fail();
        } else if (isName(outer) && ["RL", "RunLengthDecode"].includes(outer.name)) {
          let decoded = 0, ended = false;
          while (at < bytes.length) {
            const length = bytes[at++];
            if (length === 128) { ended = true; break; }
            at += length < 128 ? length + 1 : 1;
            decoded += length < 128 ? length + 1 : 257 - length;
            if (at > bytes.length || decoded > 64 * 1024 * 1024) fail();
          }
          if (!ended) fail();
        } else throw Error("このインライン画像の圧縮形式の境界を確認できません。対応形式は非圧縮・ASCIIHex・ASCII85・RunLengthです。");
        if (at - dataStart > 64 * 1024 * 1024 || !white(bytes[at])) fail();
        skip();
        if (bytes[at++] !== 69 || bytes[at++] !== 73 || (at < bytes.length && !delimiter(bytes[at]))) fail();
        operations.push({ operator: "BI", args: [parameters], start, end: at });
        args = []; skip(); start = at;
        if (operations.length > 200000) fail();
        continue;
      }
      operations.push({ operator: v.operator, args, start, end: at });
      args = [];
      skip();
      start = at;
      if (operations.length > 200000) fail();
    } else args.push(v);
    skip();
  }
  if (args.length) fail();
  return operations;
}
function isOperator(
  v: Operand | { operator: string },
): v is { operator: string } {
  return !!v && typeof v === "object" && "operator" in v;
}
export function isName(
  v: Operand | { operator: string } | undefined,
): v is { name: string } {
  return !!v && typeof v === "object" && "name" in v;
}
