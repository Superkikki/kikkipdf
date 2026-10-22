import { isName, parseContent, type Operand } from "./parser";
import { predefinedCMap, type CharacterMap } from "./predefinedCMaps";

/** Embedded Encoding CMaps map source codes to CIDs, independently of ToUnicode. */
export async function embeddedCMap(bytes: Uint8Array, inheritedName?: string, writingMode?: number): Promise<CharacterMap> {
  if (bytes.length > 8 * 1024 * 1024) throw Error("文字コード対応表が大きすぎます。");
  const result: CharacterMap = { vertical: false, ranges: [], values: new Map() };
  let parent = inheritedName, mode = "", count = 0, writing: boolean | undefined;
  const fail = () => { throw Error("埋め込み文字コード対応表を検証できません。"); };
  const code = (v: Operand) => {
    if (!(v instanceof Uint8Array) || !v.length || v.length > 4) return fail();
    return { length: v.length, value: Array.from(v).reduce((a, b) => a * 256 + b, 0) };
  };
  const cid = (v: Operand) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 65535) return fail();
    return v;
  };
  const put = (source: number, target: number) => {
    if (result.values.size >= 262144 || result.values.has(source) || target > 65535) fail();
    result.values.set(source, target);
  };
  for (const op of parseContent(bytes)) {
    if (op.operator === "usecmap") {
      if (op.args.length !== 1 || !isName(op.args[0])) fail();
      const name = (op.args[0] as { name: string }).name;
      if (parent && parent !== name) fail();
      parent = name;
    } else if (op.operator === "def" && isName(op.args[0]) && op.args[0].name === "WMode") {
      if (op.args.length !== 2 || ![0, 1].includes(op.args[1] as number) || writing !== undefined) fail();
      writing = op.args[1] === 1;
    } else if (["begincodespacerange", "begincidchar", "begincidrange", "beginnotdefchar", "beginnotdefrange"].includes(op.operator)) {
      if (mode || op.args.length !== 1 || typeof op.args[0] !== "number" || !Number.isInteger(op.args[0]) || op.args[0] < 0 || op.args[0] > 65536) fail();
      count = op.args[0] as number; mode = op.operator.slice(5);
    } else if (["endcodespacerange", "endcidchar", "endcidrange", "endnotdefchar", "endnotdefrange"].includes(op.operator)) {
      const stride = mode === "codespacerange" || mode === "cidchar" || mode === "notdefchar" ? 2 : 3;
      if (!mode || op.operator !== `end${mode}` || op.args.length !== count * stride) fail();
      for (let i = 0; i < op.args.length; i += stride) {
        const first = code(op.args[i]);
        if (mode === "cidchar") put(first.value, cid(op.args[i + 1]));
        else if (mode === "notdefchar") cid(op.args[i + 1]);
        else {
          const last = code(op.args[i + 1]);
          if (first.length !== last.length || last.value < first.value) fail();
          if (mode === "codespacerange") {
            if (result.ranges.length >= 256) fail();
            result.ranges.push({ length: first.length, low: first.value, high: last.value });
          } else {
            const target = cid(op.args[i + 2]);
            if (mode === "cidrange") {
              if (target + last.value - first.value > 65535) fail();
              for (let n = first.value; n <= last.value; n++) put(n, target + n - first.value);
            }
          }
        }
      }
      mode = "";
    } else if (["beginbfchar", "beginbfrange"].includes(op.operator)) fail();
  }
  if (mode) fail();
  if (parent) {
    const inherited = await predefinedCMap(parent);
    result.vertical = inherited.vertical;
    result.identity = inherited.identity;
    if (!result.ranges.length) result.ranges = inherited.ranges;
    for (const [code, value] of inherited.values) if (!result.values.has(code)) result.values.set(code, value);
  }
  if (writingMode !== undefined) {
    if (![0, 1].includes(writingMode) || writing !== undefined && writing !== (writingMode === 1)) fail();
    writing = writingMode === 1;
  }
  if (writing !== undefined) result.vertical = writing;
  if (!result.ranges.length || result.values.size > 262144) fail();
  return result;
}
