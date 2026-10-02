import { parseContent, type Operand, type Operation } from "./parser";
const hex = (data: Uint8Array) =>
  Array.from(data, (n) => n.toString(16).padStart(2, "0")).join("");
export function unicodeMap(bytes: Uint8Array): Map<number, string> {
  if (bytes.length > 8 * 1024 * 1024)
    throw Error("文字マップのサイズが大きすぎます。");
  const result = new Map<number, string>();
  let mode = "";
  let expected = 0;
  const decoder = new TextDecoder("utf-16be", { fatal: true });
  const code = (value: Operand) => {
    if (!(value instanceof Uint8Array) || value.length < 1 || value.length > 2)
      throw Error("文字コードの形式は未対応です。");
    return parseInt(hex(value), 16);
  };
  const text = (value: Operand) => {
    if (!(value instanceof Uint8Array) || value.length % 2 || !value.length)
      throw Error("Unicode文字マップが不正です。");
    return decoder.decode(value);
  };
  function pairs(op: Operation) {
    const args = op.args;
    const stride = mode === "bfchar" ? 2 : 3;
    if (!mode || args.length !== expected * stride)
      throw Error("文字マップの項目数が不正です。");
    const put = (code: number, value: string) => {
      if (result.has(code)) throw Error("文字マップの範囲が重複しています。");
      result.set(code, value);
    };
    if (mode === "bfchar") {
      if (args.length % 2) throw Error("文字マップが不正です。");
      for (let i = 0; i < args.length; i += 2)
        put(code(args[i]), text(args[i + 1]));
    } else if (mode === "bfrange") {
      if (args.length % 3) throw Error("文字マップが不正です。");
      for (let i = 0; i < args.length; i += 3) {
        const first = code(args[i]),
          last = code(args[i + 1]),
          target = args[i + 2];
        if (last < first || last - first > 65535)
          throw Error("文字マップが不正です。");
        if (Array.isArray(target)) {
          if (target.length !== last - first + 1)
            throw Error("文字マップが不正です。");
          target.forEach((v, index) => put(first + index, text(v)));
        } else {
          if (!(target instanceof Uint8Array) || target.length !== 2)
            throw Error("複雑なUnicode範囲は未対応です。");
          const start = code(target);
          if (start + last - first > 65535)
            throw Error("文字マップが不正です。");
          for (let c = first; c <= last; c++)
            put(
              c,
              text(
                new Uint8Array([
                  (start + c - first) >> 8,
                  (start + c - first) & 255,
                ]),
              ),
            );
        }
      }
    }
    if (result.size > 65536) throw Error("文字マップが大きすぎます。");
  }
  // CMaps store pairs as operands immediately before endbfchar/endbfrange.
  for (const op of parseContent(bytes)) {
    if (op.operator === "usecmap")
      throw Error("外部文字マップの参照は未対応です。");
    if (op.operator === "beginbfchar" || op.operator === "beginbfrange") {
      const count = op.args[0];
      if (
        mode ||
        op.args.length !== 1 ||
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > 65536
      )
        throw Error("文字マップの項目数が不正です。");
      expected = count;
      mode = op.operator === "beginbfchar" ? "bfchar" : "bfrange";
    } else if (op.operator === "endbfchar" || op.operator === "endbfrange") {
      if (op.operator !== `end${mode}`)
        throw Error("文字マップの構造が不正です。");
      pairs(op);
      mode = "";
    }
  }
  if (mode) throw Error("文字マップが閉じられていません。");
  return result;
}
