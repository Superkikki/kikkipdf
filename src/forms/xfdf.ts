import { namespace, attributes, children, decode } from "../xml/xfdf";
import { formValueStrings, validateDataValue, type DataField } from "./data";

const xml = (value: string) => {
  // Reject lossy serialization of controls rather than changing form data.
  // eslint-disable-next-line no-control-regex
  if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(value)) throw Error("フォーム値にXMLで保存できない文字があります。");
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("\r", "&#13;").replaceAll("\n", "&#10;").replaceAll("\t", "&#9;");
};
export function formDataXfdf(fields: DataField[]): Uint8Array {
  if (!fields.length || fields.length > 5000) throw Error("フォーム値は1〜5000項目にしてください。");
  const names = new Set<string>();
  const content = fields.map(field => {
    if (!field.name || field.name.length > 1000 || names.has(field.name)) throw Error("フォーム名が空・長すぎる・重複しています。設定編集で一意の名前にしてください。");
    names.add(field.name);
    const values = formValueStrings(field); validateDataValue(field, values);
    return `<field name="${xml(field.name)}">${values.map(value => `<value>${xml(value)}</value>`).join("")}</field>`;
  }).join("\n");
  const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="${namespace}" xml:space="preserve"><fields>\n${content}\n</fields></xfdf>`);
  if (bytes.length > 8 * 1024 * 1024) throw Error("フォームXFDFは8MBまでです。");
  return bytes;
}
export function parseFormDataXfdf(bytes: Uint8Array) {
  const document = new DOMParser().parseFromString(decode(bytes), "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw Error("XFDFのXMLを解析できません。");
  const root = document.documentElement;
  if (root.localName !== "xfdf" || root.namespaceURI !== namespace) throw Error("XFDFのルート要素・名前空間が不正です。");
  attributes(root, []);
  const sections = children(root), seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.localName)) throw Error("XFDFのセクションが重複しています。");
    seen.add(section.localName);
    if (section.localName === "fields" || section.localName === "annots") {
      attributes(section, []);
      if (section.localName === "annots" && children(section).length) throw Error("注釈を含むXFDFはコメントパネルで読み込んでください。フォーム値と注釈の同時読み込みは対応していません。");
    } else if (["f", "ids"].includes(section.localName)) {
      attributes(section, section.localName === "f" ? ["href"] : ["original", "modified"]);
      if (children(section).length) throw Error("XFDFの参照情報が不正です。");
    } else throw Error("XFDFに未対応のデータがあります。");
  }
  const fields = sections.find(section => section.localName === "fields");
  if (!fields) throw Error("XFDFにフォーム値がありません。");
  const entries: { name: string; values: string[] }[] = [], names = new Set<string>();
  let count = 0;
  function walk(element: Element, parent: string, depth: number) {
    if (++count > 10000 || depth > 12) throw Error("XFDFのフォーム階層が複雑すぎます。");
    if (element.localName !== "field") throw Error("XFDFのフォーム要素が不正です。");
    attributes(element, ["name"]);
    const part = element.getAttribute("name"), name = parent ? `${parent}.${part}` : part;
    if (!part || !name || name.length > 1000) throw Error("XFDFのフォーム名が不正です。");
    const nodes = children(element), nested = nodes.filter(node => node.localName === "field"), values = nodes.filter(node => node.localName === "value");
    if (nested.length && values.length || nested.length + values.length !== nodes.length) throw Error("XFDFのフォーム構造が不正です。");
    if (nested.length) { for (const child of nested) walk(child, name, depth + 1); return; }
    if (names.has(name) || entries.length >= 5000 || values.length > 1000) throw Error("XFDFの項目・値が多すぎるか名前が重複しています。");
    names.add(name);
    entries.push({ name, values: values.map(value => {
      attributes(value, []);
      if (Array.from(value.childNodes).some(node => !new Set<number>([Node.TEXT_NODE, Node.CDATA_SECTION_NODE, Node.COMMENT_NODE]).has(node.nodeType))) throw Error("XFDFの値にリッチテキストなどの未対応要素があります。");
      const text = value.textContent ?? "";
      if (text.length > 1_000_000) throw Error("XFDFの入力値が長すぎます。");
      return text;
    }) });
  }
  for (const element of children(fields)) walk(element, "", 0);
  if (!entries.length) throw Error("XFDFにフォーム値がありません。");
  return entries;
}
