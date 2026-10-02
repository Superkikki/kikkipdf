import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { boundedDecode, sourceFonts } from "./pdfFonts";
import { isName, parseContent, type Operand, type Operation } from "./parser";
import type {
  DirectInspection,
  DirectTextRun,
  SourceTextReference,
} from "./model";
type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
const key = (name: string) => PDFName.of(name);
const number = (n: Operand | undefined) => {
  if (typeof n !== "number" || !Number.isFinite(n))
    throw Error("文字描画の引数が不正です。");
  return n;
};
const numbers = (op: Operation, count: number) => {
  if (op.args.length !== count) throw Error("描画命令の引数が不正です。");
  return op.args.map(number);
};
const format = (n: number) => {
  if (!Number.isFinite(n) || Math.abs(n) > 1e10)
    throw Error("文字位置の補正量が大きすぎます。");
  return n.toFixed(9).replace(/\.?0+$/, "") || "0";
};
const rgb = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
interface Analyzed extends DirectInspection {
  bytes: Uint8Array;
  replacements: Map<number, { start: number; end: number; text: string }>;
  hash: string;
}
/** Only page-local horizontal, visible fill text with verified font widths is editable.
 * Replacement removes glyph strings; numeric TJ movement retains downstream positions.
 * This is editing, not a guarantee of redaction across other objects/metadata.
 */
export async function analyzePage(
  page: PDFPage,
  sourceIndex: number,
): Promise<Analyzed> {
  const userUnit =
    page.node.lookupMaybe(key("UserUnit"), PDFNumber)?.asNumber() ?? 1;
  if (userUnit !== 1)
    throw Error("特殊なページ倍率（UserUnit）の直接編集には未対応です。");
  const contents = page.node.Contents(),
    parts: Uint8Array[] = [];
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((v) => page.doc.context.lookup(v))
      : contents
        ? [contents]
        : [];
  if (streams.length > 200000) throw Error("描画ストリームが多すぎます。");
  let length = 0,
    operationCount = 0;
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream))
      throw Error("直接編集できない描画ストリームです。");
    const bytes = boundedDecode(stream, 64 * 1024 * 1024 - length);
    length += bytes.length;
    parts.push(bytes);
    // Refuse lexical tokens split across stream boundaries rather than changing them.
    operationCount += parseContent(bytes).length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const operations = parseContent(bytes),
    resources = page.node.Resources(),
    fonts = await sourceFonts(resources);
  // Keep stream concatenation byte-for-byte. A comment/token crossing a boundary
  // can change the meaning of unrelated operations, so refuse such documents.
  if (operations.length !== operationCount)
    throw Error("ストリーム境界をまたぐ描画命令は直接編集できません。");
  const base = page.getCropBox();
  const runs: DirectTextRun[] = [],
    replacements = new Map<
      number,
      { start: number; end: number; text: string }
    >();
  let state = {
    ctm: identity(),
    font: "",
    size: 0,
    tc: 0,
    tw: 0,
    tz: 1,
    leading: 0,
    rise: 0,
    render: 0,
    color: "#000000" as string | undefined,
    opacity: 1,
    clip: false,
    effects: false,
  };
  const stack: (typeof state)[] = [],
    marked: boolean[] = [];
  let tm = identity(),
    lm = identity(),
    inside = false,
    positionValid = true,
    unsupported: string | undefined;
  const nextLine = (x: number, y: number) => {
    lm = multiply(lm, [1, 0, 0, 1, x, y]);
    tm = [...lm];
  };
  const passive = new Set(
    "m l c v y h re S s f F f* B B* b b* n w J j M d ri i sh MP DP BX EX".split(
      " ",
    ),
  );
  for (const [operatorIndex, op] of operations.entries()) {
    const { operator, args } = op;
    switch (operator) {
      case "q":
        if (stack.length > 128) throw Error("描画状態が複雑すぎます。");
        stack.push({ ...state, ctm: [...state.ctm] });
        break;
      case "Q": {
        const saved = stack.pop();
        if (!saved) throw Error("描画状態の復元が不正です。");
        state = saved;
        break;
      }
      case "cm":
        state.ctm = multiply(state.ctm, numbers(op, 6) as Matrix);
        break;
      case "BT":
        if (inside) throw Error("文字オブジェクトが不正です。");
        inside = true;
        tm = identity();
        lm = identity();
        positionValid = true;
        break;
      case "ET":
        if (!inside) throw Error("文字オブジェクトが不正です。");
        inside = false;
        break;
      case "Tf":
        if (!isName(args[0]) || args.length !== 2)
          throw Error("フォント指定が不正です。");
        state.font = args[0].name;
        state.size = number(args[1]);
        break;
      case "Tc":
        state.tc = numbers(op, 1)[0];
        break;
      case "Tw":
        state.tw = numbers(op, 1)[0];
        break;
      case "Tz":
        state.tz = numbers(op, 1)[0] / 100;
        break;
      case "TL":
        state.leading = numbers(op, 1)[0];
        break;
      case "Ts":
        state.rise = numbers(op, 1)[0];
        break;
      case "Tr":
        state.render = numbers(op, 1)[0];
        if (state.render >= 4) state.clip = true;
        break;
      case "Tm":
        tm = numbers(op, 6) as Matrix;
        lm = [...tm];
        positionValid = true;
        break;
      case "TD": {
        const [x, y] = numbers(op, 2);
        state.leading = -y;
        nextLine(x, y);
        break;
      }
      case "Td": {
        const [x, y] = numbers(op, 2);
        nextLine(x, y);
        break;
      }
      case "T*":
        nextLine(0, -state.leading);
        break;
      case "rg": {
        const [r, g, b] = numbers(op, 3);
        state.color = rgb(r, g, b);
        break;
      }
      case "g": {
        const [g] = numbers(op, 1);
        state.color = rgb(g, g, g);
        break;
      }
      case "k": {
        const [c, m, y, k] = numbers(op, 4);
        state.color = rgb(
          1 - Math.min(1, c + k),
          1 - Math.min(1, m + k),
          1 - Math.min(1, y + k),
        );
        break;
      }
      case "cs":
      case "sc":
      case "scn":
        state.color = undefined;
        break;
      case "CS":
      case "SC":
      case "SCN":
      case "G":
      case "RG":
      case "K":
        break;
      case "W":
      case "W*":
        state.clip = true;
        break;
      case "Do":
        unsupported ??= "Form XObject内の文字は未対応です。";
        break;
      case "gs": {
        if (!isName(args[0])) throw Error("描画状態の指定が不正です。");
        const ext = resources
          ?.lookupMaybe(key("ExtGState"), PDFDict)
          ?.lookupMaybe(key(args[0].name), PDFDict);
        if (!ext) throw Error("描画状態がありません。");
        state.opacity =
          ext.lookupMaybe(key("ca"), PDFNumber)?.asNumber() ?? state.opacity;
        if (
          ext.has(key("Font")) ||
          ext.has(key("SMask")) ||
          ext.has(key("BM")) ||
          ext.has(key("TR")) ||
          ext.has(key("TR2"))
        )
          state.effects = true;
        break;
      }
      case "BMC":
        marked.push(false);
        break;
      case "BDC": {
        const properties = args[1];
        const actual =
          properties instanceof Map
            ? properties.has("ActualText")
            : isName(properties)
              ? (resources
                  ?.lookupMaybe(key("Properties"), PDFDict)
                  ?.lookupMaybe(key(properties.name), PDFDict)
                  ?.has(key("ActualText")) ?? true)
              : true;
        marked.push(actual);
        break;
      }
      case "EMC":
        if (!marked.length) throw Error("マーク付き描画の構造が不正です。");
        marked.pop();
        break;
      case "Tj":
      case "TJ":
      case "'":
      case '"': {
        if (!inside) throw Error("文字オブジェクト外の描画命令です。");
        let prefix = "",
          value = args[0];
        if (operator === '"') {
          if (args.length !== 3) throw Error("文字描画の引数が不正です。");
          state.tw = number(args[0]);
          state.tc = number(args[1]);
          value = args[2];
          prefix = `${format(state.tw)} Tw ${format(state.tc)} Tc T* `;
          nextLine(0, -state.leading);
        } else if (operator === "'") {
          prefix = "T* ";
          nextLine(0, -state.leading);
        } else if (args.length !== 1) throw Error("文字描画の引数が不正です。");
        const items =
          operator === "TJ"
            ? Array.isArray(value)
              ? value
              : undefined
            : value instanceof Uint8Array
              ? [value]
              : undefined;
        if (!items) throw Error("文字描画の引数が不正です。");
        const font = fonts.get(state.font);
        let advance = 0,
          text = "",
          verified = !!font;
        try {
          for (const item of items) {
            if (typeof item === "number")
              advance -= (item / 1000) * state.size * state.tz;
            else if (item instanceof Uint8Array && font)
              for (const glyph of font.glyphs(item)) {
                text += glyph.text;
                advance +=
                  ((glyph.width / 1000) * state.size +
                    state.tc +
                    (glyph.wordSpace ? state.tw : 0)) *
                  state.tz;
              }
            else {
              if (!(item instanceof Uint8Array))
                throw Error("文字配列が不正です。");
              verified = false;
            }
          }
        } catch {
          verified = false;
        }
        const m = multiply(state.ctm, tm),
          horizontal =
            Math.abs(m[1]) < 1e-7 &&
            Math.abs(m[2]) < 1e-7 &&
            m[0] > 0 &&
            m[3] > 0;
        const size = state.size * m[3],
          baseline = base.y + base.height - (m[5] + state.rise * m[3]);
        if (
          verified &&
          positionValid &&
          horizontal &&
          size > 0 &&
          state.tz > 0 &&
          state.render === 0 &&
          state.opacity > 0 &&
          !state.clip &&
          !state.effects &&
          state.color &&
          !marked.some(Boolean) &&
          text.trim()
        ) {
          runs.push({
            reference: {
              sourceIndex,
              contentHash: hash,
              operatorIndex,
              originalText: text,
            },
            text,
            x: m[4] - base.x,
            y: baseline - size,
            width: Math.max(1, Math.abs(advance * m[0])),
            height: size * 1.25,
            baseline,
            fontSize: size,
            color: state.color,
            opacity: Math.max(0, Math.min(1, state.opacity)),
            font: /Times/.test(font!.name)
              ? "serif"
              : /Courier/.test(font!.name)
                ? "mono"
                : /Helvetica|Arial/.test(font!.name)
                  ? "sans"
                  : "japanese",
            bold: /Bold/.test(font!.name),
            italic: /Italic|Oblique/.test(font!.name),
          });
          replacements.set(operatorIndex, {
            start: op.start,
            end: op.end,
            text: `${prefix}[${format((-advance * 1000) / (state.size * state.tz))}] TJ`,
          });
        } else
          unsupported ??=
            "この文字のフォント・文字組み・クリッピングは直接編集の対象外です。";
        if (!verified) positionValid = false;
        else tm = multiply(tm, [1, 0, 0, 1, advance, 0]);
        break;
      }
      default:
        if (!passive.has(operator))
          throw Error(`未対応の描画命令を含みます: ${operator}`);
    }
  }
  if (inside || stack.length || marked.length)
    throw Error("閉じられていない描画状態があります。");
  return { runs, unsupported, bytes, replacements, hash };
}
export async function inspectDirectText(
  bytes: Uint8Array,
  index: number,
): Promise<DirectInspection> {
  try {
    const doc = await PDFDocument.load(bytes),
      result = await analyzePage(doc.getPage(index), index);
    return { runs: result.runs, unsupported: result.unsupported };
  } catch (e) {
    return {
      runs: [],
      unsupported: e instanceof Error ? e.message : "文字を解析できません。",
    };
  }
}
export async function rewrittenContent(
  page: PDFPage,
  index: number,
  references: SourceTextReference[],
): Promise<Uint8Array> {
  const analysis = await analyzePage(page, index),
    selected = new Set<number>();
  for (const reference of references) {
    const run = analysis.runs.find(
      (r) => r.reference.operatorIndex === reference.operatorIndex,
    );
    if (
      reference.sourceIndex !== index ||
      reference.contentHash !== analysis.hash ||
      !run ||
      run.text !== reference.originalText ||
      selected.has(reference.operatorIndex)
    )
      throw Error("直接編集する元の文字を確認できません。保存を停止しました。");
    selected.add(reference.operatorIndex);
  }
  const edits = [...selected]
    .map((i) => analysis.replacements.get(i)!)
    .sort((a, b) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let previous = 0;
  for (const edit of edits) {
    parts.push(
      analysis.bytes.subarray(previous, edit.start),
      new TextEncoder().encode(edit.text),
    );
    previous = edit.end;
  }
  // Delimit this NEW stream from wrappers/appended streams generated by pdf-lib.
  parts.push(analysis.bytes.subarray(previous), new Uint8Array([10]));
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}
