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
  DirectImageRun,
  DirectImageEdit,
  DirectTextRun,
  SourceTextReference,
} from "./model";
import { textReferenceKey } from "./model";
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
const containsBox = (outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x - 1e-7 && inner.y >= outer.y - 1e-7 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-7 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-7;
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
interface GraphicsState {
  ctm: Matrix; font: string; size: number; tc: number; tw: number; tz: number;
  leading: number; rise: number; render: number; color: string | undefined;
  opacity: number; clip: boolean; effects: boolean;
}
const initialState = (): GraphicsState => ({
  ctm: identity(), font: "", size: 0, tc: 0, tw: 0, tz: 1, leading: 0,
  rise: 0, render: 0, color: "#000000", opacity: 1, clip: false, effects: false,
});
interface AnalysisBudget { bytes: number; operations: number; forms: number; }
interface Analyzed extends DirectInspection {
  bytes: Uint8Array;
  images: DirectImageRun[];
  replacements: Map<number, { start: number; end: number; text: string }>;
  hash: string;
  resources: PDFDict | undefined;
  children: Map<number, { analysis: Analyzed; stream: PDFRawStream; name: string }>;
}
/** Only horizontal, visible fill text with verified font widths is editable.
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
  const operations = parseContent(bytes);
  // Keep stream concatenation byte-for-byte. Refuse tokens crossing a boundary.
  if (operations.length !== operationCount)
    throw Error("ストリーム境界をまたぐ描画命令は直接編集できません。");
  return analyzeContent(page, sourceIndex, bytes, page.node.Resources(), initialState(), [],
    new Set(), { bytes: 0, operations: 0, forms: 0 }, []);
}
async function analyzeContent(
  page: PDFPage, sourceIndex: number, bytes: Uint8Array, resources: PDFDict | undefined,
  inherited: GraphicsState, formPath: number[], active: Set<PDFRawStream>, budget: AnalysisBudget,
  bounds: { x: number; y: number; width: number; height: number }[], parentHash = "",
): Promise<Analyzed> {
  budget.bytes += bytes.length;
  if (budget.bytes > 64 * 1024 * 1024) throw Error("Form XObjectの展開サイズが大きすぎます。");
  const parentBytes = new TextEncoder().encode(parentHash);
  const digestInput = new Uint8Array(bytes.length + parentBytes.length);
  digestInput.set(parentBytes);
  digestInput.set(bytes, parentBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const operations = parseContent(bytes), fonts = await sourceFonts(resources);
  budget.operations += operations.length;
  if (budget.operations > 200000) throw Error("Form XObjectの描画命令が多すぎます。");
  const children: Analyzed["children"] = new Map();
  const base = page.getCropBox();
  const images: DirectImageRun[] = [];
  const runs: DirectTextRun[] = [],
    replacements = new Map<
      number,
      { start: number; end: number; text: string }
    >();
  let state = { ...inherited, ctm: [...inherited.ctm] as Matrix };
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
      case "Do": {
        if (!isName(args[0]) || args.length !== 1 || inside)
          throw Error("Form XObjectの呼び出しが不正です。");
        const stream = resources?.lookupMaybe(key("XObject"), PDFDict)?.lookup(key(args[0].name));
        if (!(stream instanceof PDFRawStream)) throw Error("XObjectがありません。");
        const subtype = stream.dict.lookupMaybe(key("Subtype"), PDFName)?.decodeText();
        if (subtype === "Image") {
          const [a, b, c, d, e, f] = state.ctm;
          const box = { x: e - base.x, y: base.y + base.height - f - d, width: a, height: d };
          if (Math.abs(b) < 1e-7 && Math.abs(c) < 1e-7 && a > 0 && d > 0 &&
              [a, d, e, f].every(Number.isFinite) && !state.clip && !state.effects && state.opacity > 0 &&
              !marked.some(Boolean) && !stream.dict.has(key("OC")) && !stream.dict.has(key("F")) &&
              bounds.every(limit => containsBox(limit, box)))
            images.push({ ...box, bounds, reference: { sourceIndex, contentHash: hash,
              operatorIndex, resourceName: args[0].name, ...(formPath.length ? { formPath } : {}) } });
          else unsupported ??= "クリッピング・回転など特殊な既存画像は直接編集できません。";
          break;
        }
        if (subtype !== "Form" || stream.dict.has(key("Group")) ||
            stream.dict.has(key("Ref")) || stream.dict.has(key("OC")) || stream.dict.has(key("F")) ||
            (stream.dict.lookupMaybe(key("FormType"), PDFNumber)?.asNumber() ?? 1) !== 1) {
          unsupported ??= "特殊なForm XObject内の文字は直接編集できません。";
          break;
        }
        if (active.has(stream) || formPath.length >= 16 || ++budget.forms > 4096)
          throw Error("Form XObjectが循環参照しているか、複雑すぎます。");
        const array = (name: string, count: number, fallback?: number[]) => {
          const value = stream.dict.lookupMaybe(key(name), PDFArray);
          if (!value && fallback) return fallback;
          if (!value || value.size() !== count) throw Error("Form XObjectの配置が不正です。");
          return value.asArray().map(v => number(page.doc.context.lookup(v) instanceof PDFNumber
            ? (page.doc.context.lookup(v) as PDFNumber).asNumber() : undefined));
        };
        const matrix = array("Matrix", 6, identity()) as Matrix,
          bbox = array("BBox", 4), ctm = multiply(state.ctm, matrix);
        if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) throw Error("Form XObjectの範囲が不正です。");
        // A transformed rectangular BBox must remain an axis-aligned rectangle.
        if (Math.abs(ctm[1]) > 1e-7 || Math.abs(ctm[2]) > 1e-7 || ctm[0] <= 0 || ctm[3] <= 0) {
          unsupported ??= "回転・傾斜したForm XObject内の文字は直接編集できません。";
          break;
        }
        const formBounds = { x: ctm[0] * bbox[0] + ctm[4] - base.x,
          y: base.y + base.height - (ctm[3] * bbox[3] + ctm[5]),
          width: ctm[0] * (bbox[2] - bbox[0]), height: ctm[3] * (bbox[3] - bbox[1]) };
        active.add(stream);
        const childResources = stream.dict.lookupMaybe(key("Resources"), PDFDict) ?? resources;
        const analysis = await analyzeContent(page, sourceIndex,
          boundedDecode(stream, 64 * 1024 * 1024 - budget.bytes), childResources,
          { ...state, ctm, font: "", size: 0, effects: state.effects || marked.some(Boolean) }, [...formPath, operatorIndex], active, budget,
          [...bounds, formBounds], hash + JSON.stringify({ matrix, bbox }));
        active.delete(stream);
        children.set(operatorIndex, { analysis, stream, name: args[0].name });
        runs.push(...analysis.runs);
        images.push(...analysis.images);
        unsupported ??= analysis.unsupported;
        break;
      }
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
        const font = fonts.get(state.font), vertical = !!font?.vertical, m = multiply(state.ctm, tm);
        const verticalBoxes: { x: number; y: number; width: number; height: number }[] = [];
        let firstVerticalPen: number | undefined;
        let advance = 0,
          text = "",
          verified = !!font;
        try {
          for (const item of items) {
            if (typeof item === "number")
              advance -= (item / 1000) * state.size * (vertical ? 1 : state.tz);
            else if (item instanceof Uint8Array && font)
              for (const glyph of font.glyphs(item)) {
                text += glyph.text;
                if (vertical) {
                  if (!glyph.vmetric) throw Error("縦書きの原点情報がありません。");
                  const [dy, vx, vy] = glyph.vmetric;
                  firstVerticalPen ??= advance;
                  const baseline = base.y + base.height - (m[5] + (advance + state.rise - vy / 1000 * state.size) * m[3]);
                  verticalBoxes.push({ x: m[4] - vx / 1000 * state.size * state.tz * m[0] - base.x,
                    y: baseline - state.size * m[3], width: glyph.width / 1000 * state.size * state.tz * m[0],
                    height: state.size * m[3] * 1.25 });
                  advance += dy / 1000 * state.size + state.tc;
                } else advance += ((glyph.width / 1000) * state.size + state.tc +
                    (glyph.wordSpace ? state.tw : 0)) * state.tz;
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
        const horizontal =
            Math.abs(m[1]) < 1e-7 &&
            Math.abs(m[2]) < 1e-7 &&
            m[0] > 0 &&
            m[3] > 0;
        const size = state.size * m[3],
          baseline = base.y + base.height - (m[5] + state.rise * m[3]);
        const extent = verticalBoxes.reduce((v, b) => ({ left: Math.min(v.left, b.x), top: Math.min(v.top, b.y),
          right: Math.max(v.right, b.x + b.width), bottom: Math.max(v.bottom, b.y + b.height) }),
          { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const box = vertical && verticalBoxes.length ? {
          x: extent.left, y: extent.top, width: extent.right - extent.left, height: extent.bottom - extent.top,
        } : { x: m[4] - base.x, y: baseline - size, width: Math.max(1, Math.abs(advance * m[0])), height: size * 1.25 };
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
          text.trim() &&
          bounds.every(b => containsBox(b, box))
        ) {
          runs.push({
            reference: {
              sourceIndex,
              contentHash: hash,
              operatorIndex,
              originalText: text,
              ...(formPath.length ? { formPath } : {}),
            },
            text,
            ...box,
            ...(vertical ? { writingMode: "vertical" as const, flowX: m[4] - base.x,
              flowTop: base.y + base.height - (m[5] + ((firstVerticalPen ?? 0) + state.rise) * m[3]),
              flowEnd: base.y + base.height - (m[5] + (advance + state.rise) * m[3]) } : {}),
            baseline,
            fontSize: size,
            color: state.color,
            opacity: Math.max(0, Math.min(1, state.opacity)),
            font: vertical ? "japanese" : /Times/.test(font!.name)
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
            // PDF.js text extraction adds Tc even to an empty numeric TJ.
            // Temporarily clear it so both raster and text-layer positions stay exact.
            text: `${prefix}${state.tc ? "0 Tc " : ""}[${format((-advance * 1000) / (state.size * (vertical ? 1 : state.tz)))}] TJ${state.tc ? ` ${format(state.tc)} Tc` : ""}`,
          });
        } else
          unsupported ??=
            "この文字のフォント・文字組み・クリッピングは直接編集の対象外です。";
        if (!verified) positionValid = false;
        else tm = multiply(tm, [1, 0, 0, 1, vertical ? 0 : advance, vertical ? advance : 0]);
        break;
      }
      default:
        if (!passive.has(operator))
          throw Error(`未対応の描画命令を含みます: ${operator}`);
    }
  }
  if (inside || stack.length || marked.length)
    throw Error("閉じられていない描画状態があります。");
  return { runs, images, unsupported, bytes, replacements, hash, resources, children };
}
export async function inspectDirectText(
  bytes: Uint8Array,
  index: number,
): Promise<DirectInspection> {
  try {
    const doc = await PDFDocument.load(bytes),
      result = await analyzePage(doc.getPage(index), index);
    return { runs: result.runs, images: result.images, unsupported: result.unsupported };
  } catch (e) {
    return {
      runs: [],
      unsupported: e instanceof Error ? e.message : "文字を解析できません。",
    };
  }
}
export async function rewrittenPage(
  page: PDFPage, index: number, references: SourceTextReference[], imageEdits: DirectImageEdit[] = [],
): Promise<{ bytes: Uint8Array; resources: PDFDict | undefined }> {
  const analysis = await analyzePage(page, index), selected = new Set<string>();
  for (const reference of references) {
    const id = textReferenceKey(reference);
    const run = analysis.runs.find(r => textReferenceKey(r.reference) === id);
    if (reference.sourceIndex !== index || !run ||
        reference.contentHash !== run.reference.contentHash || run.text !== reference.originalText || selected.has(id))
      throw Error("直接編集する元の文字を確認できません。保存を停止しました。");
    selected.add(id);
  }
  const images = new Map<string, { run: DirectImageRun; edit: DirectImageEdit }>();
  for (const edit of imageEdits) {
    const ref = edit.reference, id = textReferenceKey(ref);
    const run = analysis.images.find(r => textReferenceKey(r.reference) === id);
    const original = ref.originalBox;
    if (!run || ref.sourceIndex !== index || ref.contentHash !== run.reference.contentHash ||
        ref.resourceName !== run.reference.resourceName || selected.has(id) ||
        !original || !["x", "y", "width", "height"].every(k => Math.abs(original[k as keyof typeof original] - run[k as keyof typeof original]) < 1e-7))
      throw Error("直接編集する元の画像を確認できません。保存を停止しました。");
    if (![edit.x, edit.y, edit.width, edit.height].every(n => Number.isFinite(n) && Math.abs(n) <= 1000000) ||
        edit.width <= 0 || edit.height <= 0 || (!edit.deleted && !run.bounds.every(limit => containsBox(limit, edit))))
      throw Error("画像の配置が不正か、元の部品の表示範囲を超えています。");
    selected.add(id); images.set(id, { run, edit });
  }
  function rewrite(node: Analyzed, path: number[]): { bytes: Uint8Array; resources: PDFDict | undefined } {
    const edits = [...node.replacements.entries()]
      .filter(([i]) => selected.has([...path, i].join("/"))).map(([, edit]) => edit);
    let resources = node.resources;
    const operations = parseContent(node.bytes);
    for (const run of node.images) {
      if (JSON.stringify(run.reference.formPath ?? []) !== JSON.stringify(path)) continue;
      const changed = images.get(textReferenceKey(run.reference));
      if (!changed) continue;
      const { edit } = changed, op = operations[run.reference.operatorIndex];
      const correction = [edit.width / run.width, 0, 0, edit.height / run.height,
        (edit.x - run.x) / run.width, (run.y + run.height - edit.y - edit.height) / run.height];
      edits.push({ start: op.start, end: op.end, text: edit.deleted ? "" :
        `q ${correction.map(format).join(" ")} cm ${key(run.reference.resourceName).toString()} Do Q` });
      if (resources === node.resources && resources) {
        resources = resources.clone();
        const xobjects = resources.lookupMaybe(key("XObject"), PDFDict);
        if (xobjects) resources.set(key("XObject"), xobjects.clone());
      }
    }
    for (const [i, child] of node.children) {
      const childPath = [...path, i], prefix = childPath.join("/") + "/";
      if (![...selected].some(id => id.startsWith(prefix))) continue;
      const rewritten = rewrite(child.analysis, childPath);
      resources ??= page.doc.context.obj({});
      if (resources === node.resources) resources = resources.clone();
      let xobjects = resources.lookupMaybe(key("XObject"), PDFDict);
      xobjects = xobjects?.clone() ?? page.doc.context.obj({});
      resources.set(key("XObject"), xobjects);
      let name = "KikkiEditedForm" + i;
      while (xobjects.has(key(name))) name += "_";
      // Give this invocation its own stream/resources; shared source objects stay immutable.
      const dict = child.stream.dict.clone();
      for (const entry of ["Filter", "DecodeParms", "Length"]) dict.delete(key(entry));
      if (rewritten.resources) dict.set(key("Resources"), rewritten.resources);
      const stream = PDFRawStream.of(dict, rewritten.bytes);
      xobjects.set(key(name), page.doc.context.register(stream));
      edits.push({ start: operations[i].start, end: operations[i].end, text: `${key(name).toString()} Do` });
    }
    edits.sort((a, b) => a.start - b.start);
    const parts: Uint8Array[] = [];
    let previous = 0;
    for (const edit of edits) {
      parts.push(node.bytes.subarray(previous, edit.start), new TextEncoder().encode(edit.text));
      previous = edit.end;
    }
    parts.push(node.bytes.subarray(previous), new Uint8Array([10]));
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    if (resources !== node.resources) {
      const used = new Set(parseContent(bytes).filter(op => op.operator === "Do" && isName(op.args[0]))
        .map(op => (op.args[0] as { name: string }).name));
      const xobjects = resources?.lookupMaybe(key("XObject"), PDFDict);
      for (const [name] of xobjects?.entries() ?? [])
        if (!used.has(name.decodeText())) xobjects!.delete(name);
    }
    return { bytes, resources };
  }
  return rewrite(analysis, []);
}
/** Byte-only helper; Form edits also install their isolated resources on this page. */
export async function rewrittenContent(page: PDFPage, index: number, references: SourceTextReference[]) {
  const result = await rewrittenPage(page, index, references);
  if (result.resources) page.node.set(key("Resources"), result.resources);
  return result.bytes;
}
