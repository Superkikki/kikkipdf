export const namespace = "http://ns.adobe.com/xfdf/";
const maxBytes = 8 * 1024 * 1024;
export function attributes(element: Element, allowed: readonly string[]) {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
    if (attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space") continue;
    if (attribute.namespaceURI || !allowed.includes(attribute.name))
      throw Error(`XFDFの未対応属性です: ${element.localName}/${attribute.name}`);
  }
}
export function children(element: Element) {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) throw Error("XFDFの要素構造が不正です。");
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE)
      throw Error("XFDFに未対応のXML要素があります。");
  }
  const result = Array.from(element.children);
  if (result.some(child => child.namespaceURI !== namespace)) throw Error("XFDFの名前空間が不正です。");
  return result;
}
export function decode(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > maxBytes) throw Error("XFDFファイルは空でない8MB以下のファイルを選んでください。");
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : undefined;
  let text: string;
  try { text = new TextDecoder(utf16 ?? "utf-8", { fatal: true }).decode(bytes); }
  catch { throw Error("XFDFの文字コードを読み込めません。UTF-8またはBOM付きUTF-16を使用してください。"); }
  const encoding = text.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase();
  if (encoding && !(utf16 ? ["utf-16", utf16].includes(encoding) : ["utf-8", "utf8"].includes(encoding)))
    throw Error("XFDFの文字コード宣言が対応するUTF-8／UTF-16ではありません。");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw Error("DTDや外部エンティティを含むXFDFは読み込めません。");
  return text;
}

