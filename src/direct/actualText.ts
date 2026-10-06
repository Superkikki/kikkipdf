import { PDFHexString, PDFName } from "pdf-lib";
import { isName, type Operand, type Operation } from "./parser";

const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
function serialize(value: Operand): string {
  if (value instanceof Uint8Array) return `<${hex(value)}>`;
  if (isName(value)) return PDFName.of(value.name).toString();
  if (value instanceof Map) return `<< ${[...value].map(([name, item]) => `${PDFName.of(name)} ${serialize(item)}`).join(" ")} >>`;
  if (Array.isArray(value)) return `[${value.map(serialize).join(" ")}]`;
  return String(value);
}
export interface ActualTextScope { text: string; operation: Operation; replacement: string }

/** Only a self-contained, single text-show scope can be edited independently. */
export function singleActualTextScopes(operations: Operation[]) {
  const result = new Map<number, ActualTextScope>();
  const stack: { index: number; shows: number[]; nested: boolean; form: boolean }[] = [];
  for (const [index, op] of operations.entries()) {
    if (op.operator === "BDC" || op.operator === "BMC") {
      if (op.operator === "BDC" && op.args[1] instanceof Map && op.args[1].has("ActualText"))
        for (const parent of stack) parent.nested = true;
      stack.push({ index, shows: [], nested: false, form: false });
    } else if (["Tj", "TJ", "'", '"'].includes(op.operator)) {
      for (const scope of stack) scope.shows.push(index);
    } else if (op.operator === "Do") {
      for (const scope of stack) scope.form = true;
    } else if (op.operator === "EMC") {
      const scope = stack.pop();
      if (!scope || scope.shows.length !== 1 || scope.nested || scope.form) continue;
      const begin = operations[scope.index], props = begin.args[1];
      if (begin.operator !== "BDC" || !isName(begin.args[0]) || !(props instanceof Map)) continue;
      const actual = props.get("ActualText");
      if (!(actual instanceof Uint8Array)) continue;
      const text = PDFHexString.of(hex(actual)).decodeText();
      if (!text.trim() || text.length > 1_000_000) continue;
      const safe = new Map(props); safe.delete("ActualText");
      result.set(scope.shows[0], { text, operation: begin, replacement: `${serialize(begin.args[0])} ${serialize(safe)} BDC` });
    }
  }
  return result;
}
