import { strToU8, zipSync } from "fflate";

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function xmlText(text: string): string {
  let safe = "";
  for (const char of text) {
    const n = char.codePointAt(0)!;
    if (n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff)) safe += char;
    else safe += "\ufffd";
  }
  return safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Editable text with page breaks. PDF formatting and graphics are not reproduced. */
export function createTextDocx(pages: string[]): Uint8Array {
  if (!pages.length || pages.length > 2000) throw Error("Wordへの書き出しは1〜2000ページまでです。");
  if (pages.reduce((n, page) => n + page.length, 0) > 10_000_000) throw Error("Wordへの書き出しは文字数合計1000万文字までです。");
  const body = pages.map((page, index) => {
    const breakBefore = index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
    const paragraphs = page.replace(/\r\n?/g, "\n").split("\n").map(line =>
      `<w:p><w:r><w:t xml:space="preserve">${xmlText(line)}</w:t></w:r></w:p>`).join("");
    return breakBefore + paragraphs;
  }).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8(contentTypes), "_rels/.rels": strToU8(relationships), "word/document.xml": strToU8(document) }, { level: 6 });
}
