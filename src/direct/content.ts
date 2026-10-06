import {
  PDFBool,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { singleActualTextScopes } from "./actualText";
import { boundedDecode, sourceFonts } from "./pdfFonts";
import { isName, parseContent, type Operand, type Operation } from "./parser";
import type {
  DirectInspection,
  DirectImageRun,
  DirectImageEdit,
  DirectTextRun,
  SourceTextReference,
  SourceImageReference,
} from "./model";
import type { Box, ImageAsset } from "../state/model";
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
  opacity: number; strokeOpacity: number; strokeColor: string | undefined; lineWidth: number; strokeEffects: boolean;
  clip: boolean; clipBounds: Box[]; effects: boolean;
}
const initialState = (): GraphicsState => ({
  ctm: identity(), font: "", size: 0, tc: 0, tw: 0, tz: 1, leading: 0,
  rise: 0, render: 0, color: "#000000", opacity: 1, strokeOpacity: 1, strokeColor: "#000000", lineWidth: 1, strokeEffects: false, clip: false, clipBounds: [], effects: false,
});
interface AnalysisBudget { bytes: number; operations: number; forms: number; }
interface Analyzed extends DirectInspection {
  bytes: Uint8Array;
  images: DirectImageRun[];
  replacements: Map<number, { start: number; end: number; text: string; metadata?: { start: number; end: number; text: string } }>;
  hash: string;
  resources: PDFDict | undefined;
  children: Map<number, { analysis: Analyzed; stream: PDFRawStream; name: string }>;
}
/** Only visible text with verified font widths and reproducible painting is editable.
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
      { start: number; end: number; text: string; metadata?: { start: number; end: number; text: string } }
    >();
  const actualText = singleActualTextScopes(operations);
  const editableScopes = new Set([...actualText.values()].map(scope => scope.operation.start));
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
  // Paths are not part of q/Q graphics state. Apply W/W* only when the path ends.
  let pathRectangle: Box | undefined, complexPath = false, pendingClip = false;
  const pathEnds = new Set("S s f F f* B B* b b* n".split(" "));
  const passive = new Set(
    "BI m l c v y h re S s f F f* B B* b b* n w J j M d ri i sh MP DP BX EX".split(
      " ",
    ),
  );
  for (const [operatorIndex, op] of operations.entries()) {
    const { operator, args } = op;
    if (pathEnds.has(operator)) {
      if (pendingClip) {
        if (pathRectangle && !complexPath) {
          if (state.clipBounds.length >= 128) throw Error("矩形クリッピングが複雑すぎます。");
          state.clipBounds = [...state.clipBounds, pathRectangle];
        }
        else state.clip = true;
      }
      pathRectangle = undefined;
      complexPath = false;
      pendingClip = false;
    }
    switch (operator) {
      case "re": {
        const [x, y, width, height] = numbers(op, 4), [a, b, c, d, e, f] = state.ctm;
        if (pathRectangle || complexPath || Math.abs(b) > 1e-7 || Math.abs(c) > 1e-7 || a === 0 || d === 0)
          complexPath = true;
        else pathRectangle = {
          x: Math.min(a * x + e, a * (x + width) + e) - base.x,
          y: base.y + base.height - Math.max(d * y + f, d * (y + height) + f),
          width: Math.abs(a * width), height: Math.abs(d * height),
        };
        break;
      }
      case "m": case "l": case "c": case "v": case "y": case "h":
        complexPath = true;
        break;
      case "w":
        state.lineWidth = numbers(op, 1)[0];
        break;
      case "J": case "j":
        if (numbers(op, 1)[0] !== 0) state.strokeEffects = true;
        break;
      case "M":
        if (numbers(op, 1)[0] !== 10) state.strokeEffects = true;
        break;
      case "d":
        if (!Array.isArray(args[0]) || args[0].length || args[1] !== 0) state.strokeEffects = true;
        break;
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
      case "CS": case "SC": case "SCN":
        state.strokeColor = undefined;
        break;
      case "G": {
        const [g] = numbers(op, 1); state.strokeColor = rgb(g, g, g); break;
      }
      case "RG": {
        const [r, g, b] = numbers(op, 3); state.strokeColor = rgb(r, g, b); break;
      }
      case "K": {
        const [c, m, y, k] = numbers(op, 4);
        state.strokeColor = rgb(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
        break;
      }
      case "W":
      case "W*":
        pendingClip = true;
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
              [a, d, e, f].every(Number.isFinite) && !state.clip && !state.clipBounds.length && !state.effects && state.opacity > 0 &&
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
        // Quarter turns keep the Form's clipping rectangle axis aligned.
        const aligned = (Math.abs(ctm[1]) < 1e-7 && Math.abs(ctm[2]) < 1e-7) ||
          (Math.abs(ctm[0]) < 1e-7 && Math.abs(ctm[3]) < 1e-7);
        if (!aligned || ctm[0] * ctm[3] - ctm[1] * ctm[2] <= 0) {
          unsupported ??= "傾斜・反転したForm XObject内の文字は直接編集できません。";
          break;
        }
        const corners = [bbox[0], bbox[2]].flatMap(x => [bbox[1], bbox[3]].map(y => ({
          x: ctm[0] * x + ctm[2] * y + ctm[4] - base.x,
          y: base.y + base.height - (ctm[1] * x + ctm[3] * y + ctm[5]),
        })));
        const formBounds = { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)),
          width: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)),
          height: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)) };
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
        state.strokeOpacity = ext.lookupMaybe(key("CA"), PDFNumber)?.asNumber() ?? state.strokeOpacity;
        state.lineWidth = ext.lookupMaybe(key("LW"), PDFNumber)?.asNumber() ?? state.lineWidth;
        if (["LC", "LJ", "ML", "D"].some(name => ext.has(key(name)))) state.strokeEffects = true;
        const blend = ext.lookup(key("BM")), mask = ext.lookup(key("SMask"));
        if (
          ext.has(key("Font")) ||
          (mask !== undefined && mask !== key("None")) ||
          (blend !== undefined && blend !== key("Normal")) ||
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
        marked.push(actual && !editableScopes.has(op.start));
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
          text = "", extractedText = "",
          verified = !!font;
        try {
          for (const item of items) {
            if (typeof item === "number")
              advance -= (item / 1000) * state.size * (vertical ? 1 : state.tz);
            else if (item instanceof Uint8Array && font)
              for (const glyph of font.glyphs(item)) {
                text += glyph.text;
                extractedText += glyph.extractedText ?? glyph.text;
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
        const scaleX = Math.hypot(m[0], m[1]), scaleY = Math.hypot(m[2], m[3]);
        // A rotation with independent positive scales is supported; shear and reflection are not.
        const orthogonal = scaleX > 0 && scaleY > 0 &&
          Math.abs((m[0] * m[2] + m[1] * m[3]) / (scaleX * scaleY)) < 1e-7 &&
          m[0] * m[3] - m[1] * m[2] > 0;
        const rotation = horizontal ? 0 : Math.atan2(-m[1], m[0]) * 180 / Math.PI;
        const size = state.size * (vertical ? m[3] : scaleY),
          baselineX = m[4] + state.rise * m[2] - base.x,
          baseline = base.y + base.height - (m[5] + state.rise * m[3]);
        const advanceWidth = advance * scaleX;
        const extent = verticalBoxes.reduce((v, b) => ({ left: Math.min(v.left, b.x), top: Math.min(v.top, b.y),
          right: Math.max(v.right, b.x + b.width), bottom: Math.max(v.bottom, b.y + b.height) }),
          { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const corners = [0, Math.max(1, advanceWidth)].flatMap(x => [-size, size * 0.25].map(y => ({
          x: baselineX + x * m[0] / scaleX - y * m[2] / scaleY,
          y: baseline - x * m[1] / scaleX + y * m[3] / scaleY,
        })));
        const box = vertical && verticalBoxes.length ? {
          x: extent.left, y: extent.top, width: extent.right - extent.left, height: extent.bottom - extent.top,
        } : {
          x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)),
          width: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)),
          height: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)),
        };
        if (
          verified &&
          positionValid &&
          (vertical ? horizontal : orthogonal) &&
          size > 0 &&
          state.tz > 0 &&
          (state.render === 0 || ([1, 2].includes(state.render) && !vertical &&
            state.strokeColor && state.strokeOpacity > 0 && (state.render === 1 || state.strokeOpacity === state.opacity) &&
            !state.strokeEffects && state.lineWidth > 0 && state.ctm[3] > 0 &&
            Math.abs(state.ctm[0] - state.ctm[3]) < 1e-7 &&
            Math.abs(state.ctm[1]) < 1e-7 && Math.abs(state.ctm[2]) < 1e-7)) &&
          (state.render === 1 ? state.strokeOpacity : state.opacity) > 0 &&
          !state.clip &&
          !state.effects &&
          (state.render === 1 ? state.strokeColor : state.color) &&
          !marked.some(Boolean) &&
          text.trim() &&
          [...bounds, ...state.clipBounds].every(b => containsBox(b, {
            x: box.x - ([1, 2].includes(state.render) ? state.lineWidth * state.ctm[0] / 2 : 0),
            y: box.y - ([1, 2].includes(state.render) ? state.lineWidth * state.ctm[3] / 2 : 0),
            width: box.width + ([1, 2].includes(state.render) ? state.lineWidth * state.ctm[0] : 0),
            height: box.height + ([1, 2].includes(state.render) ? state.lineWidth * state.ctm[3] : 0),
          }))
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
            ...(actualText.has(operatorIndex) ? { extractedText: actualText.get(operatorIndex)!.text, editableText: actualText.get(operatorIndex)!.text }
              : extractedText !== text ? { extractedText } : {}),
            ...box,
            ...(!vertical && rotation ? { rotation, baselineX, advanceWidth } : {}),
            ...(vertical ? { writingMode: "vertical" as const, flowX: m[4] - base.x,
              flowTop: base.y + base.height - (m[5] + ((firstVerticalPen ?? 0) + state.rise) * m[3]),
              flowEnd: base.y + base.height - (m[5] + (advance + state.rise) * m[3]) } : {}),
            baseline,
            fontSize: size,
            ...([1, 2].includes(state.render) ? {
              textStrokeWidth: state.lineWidth * state.ctm[3], textStrokeColor: state.strokeColor!,
              ...(state.render === 1 ? { textOutlineOnly: true } : {}),
            } : {}),
            color: (state.render === 1 ? state.strokeColor : state.color)!,
            opacity: Math.max(0, Math.min(1, state.render === 1 ? state.strokeOpacity : state.opacity)),
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
            ...(actualText.has(operatorIndex) ? { metadata: {
              start: actualText.get(operatorIndex)!.operation.start, end: actualText.get(operatorIndex)!.operation.end,
              text: actualText.get(operatorIndex)!.replacement,
            } } : {}),
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
  page: PDFPage, index: number, references: SourceTextReference[], imageEdits: DirectImageEdit[] = [], assets: Record<string, ImageAsset> = {},
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
  const replacements = new Map<string, import("pdf-lib").PDFRef>();
  for (const { edit } of images.values()) {
    if (edit.deleted || !edit.imageId || replacements.has(edit.imageId)) continue;
    const asset = assets[edit.imageId];
    if (!asset || asset.id !== edit.imageId || !asset.bytes.length || asset.bytes.length > 32 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(asset.mime))
      throw Error("差し替える画像が見つからないか形式が不正です。");
    const image = asset.mime === "image/png" ? await page.doc.embedPng(asset.bytes) : await page.doc.embedJpg(asset.bytes);
    await image.embed(); replacements.set(edit.imageId, image.ref);
  }
  function rewrite(node: Analyzed, path: number[]): { bytes: Uint8Array; resources: PDFDict | undefined } {
    const edits = [...node.replacements.entries()]
      .filter(([i]) => selected.has([...path, i].join("/"))).flatMap(([, edit]) => edit.metadata ? [edit, edit.metadata] : [edit]);
    let resources = node.resources;
    const operations = parseContent(node.bytes);
    for (const run of node.images) {
      if (JSON.stringify(run.reference.formPath ?? []) !== JSON.stringify(path)) continue;
      const changed = images.get(textReferenceKey(run.reference));
      if (!changed) continue;
      const { edit } = changed, op = operations[run.reference.operatorIndex];
      const correction = [edit.width / run.width, 0, 0, edit.height / run.height,
        (edit.x - run.x) / run.width, (run.y + run.height - edit.y - edit.height) / run.height];

      if (resources === node.resources && resources) {
        resources = resources.clone();
        const xobjects = resources.lookupMaybe(key("XObject"), PDFDict);
        if (xobjects) resources.set(key("XObject"), xobjects.clone());
      }
      let name = run.reference.resourceName;
      if (!edit.deleted && edit.imageId) {
        const xobjects = resources?.lookupMaybe(key("XObject"), PDFDict);
        if (!xobjects) throw Error("画像のリソースがありません。");
        name = "KikkiReplacementImage" + run.reference.operatorIndex;
        while (xobjects.has(key(name))) name += "_";
        xobjects.set(key(name), replacements.get(edit.imageId)!);
      }
      edits.push({ start: op.start, end: op.end, text: edit.deleted ? "" :
        `q ${correction.map(format).join(" ")} cm ${key(name).toString()} Do Q` });
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
      // The original operand may start with a delimiter directly after the
      // previous operator (e.g. Tc[...]). Numeric replacements need whitespace.
      parts.push(node.bytes.subarray(previous, edit.start), new TextEncoder().encode(`\n${edit.text}\n`));
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

/** Isolate only the verified image resource, including its masks/color space, at native pixel size. */
export async function isolatedImagePdf(bytes: Uint8Array, reference: SourceImageReference): Promise<Uint8Array> {
  const input = await PDFDocument.load(bytes);
  const analysis = await analyzePage(input.getPage(reference.sourceIndex), reference.sourceIndex);
  let node = analysis;
  for (const index of reference.formPath ?? []) {
    const child = node.children.get(index);
    if (!child) throw Error("画像の参照先が見つかりません。");
    node = child.analysis;
  }
  const run = node.images.find((image) => textReferenceKey(image.reference) === textReferenceKey(reference));
  if (!run || run.reference.contentHash !== reference.contentHash || run.reference.resourceName !== reference.resourceName)
    throw Error("画像の参照先が変更されています。");
  const image = node.resources?.lookupMaybe(key("XObject"), PDFDict)?.lookup(key(reference.resourceName));
  if (!(image instanceof PDFRawStream) || image.dict.get(key("Subtype")) !== key("Image") || image.dict.lookupMaybe(key("ImageMask"), PDFBool)?.asBoolean())
    throw Error("この画像形式の取り出しには対応していません。");
  const width = image.dict.lookupMaybe(key("Width"), PDFNumber)?.asNumber() ?? 0;
  const height = image.dict.lookupMaybe(key("Height"), PDFNumber)?.asNumber() ?? 0;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 20_000_000)
    throw Error("取り出す画像は2000万画素・各辺16384画素までです。");
  const output = await PDFDocument.create(), page = output.addPage([width, height]);
  const copier = PDFObjectCopier.for(input.context, output.context);
  const copied = copier.copy(image);
  const ref = output.context.register(copied);
  const resources = output.context.obj({ XObject: { Image: ref } });
  const colorSpaces = node.resources?.lookupMaybe(key("ColorSpace"), PDFDict);
  // Image XObjects need a self-contained color space; resolve resource aliases before rendering.
  let colorSpace = image.dict.lookup(key("ColorSpace"));
  const seen = new Set<PDFName>();
  while (colorSpace instanceof PDFName && colorSpaces?.has(colorSpace)) {
    if (seen.has(colorSpace) || seen.size >= 16) throw Error("画像の色空間の参照が循環しています。");
    seen.add(colorSpace); colorSpace = colorSpaces.lookup(colorSpace);
  }
  if (colorSpace) copied.dict.set(key("ColorSpace"), copier.copy(colorSpace));
  if (colorSpaces) resources.set(key("ColorSpace"), copier.copy(colorSpaces));
  page.node.set(key("Resources"), resources);
  page.node.set(key("Contents"), output.context.register(output.context.flateStream(`q ${width} 0 0 ${height} 0 0 cm /Image Do Q`)));
  return output.save();
}
