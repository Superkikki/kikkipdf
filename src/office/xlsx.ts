import { strToU8, zipSync } from "fflate";
import { xmlText } from "./xml";

/** Store each extracted line as a literal text cell in a separate page sheet. */
export function createTextXlsx(pages: string[], pageNumbers = pages.map((_, i) => i + 1)): Uint8Array {
  if (pageNumbers.length !== pages.length || pageNumbers.some(n => !Number.isSafeInteger(n) || n < 1 || n > 999999999) || new Set(pageNumbers).size !== pageNumbers.length) throw Error("ページ番号が不正です。");
  if (!pages.length || pages.length > 200) throw Error("Excelへの書き出しは1〜200ページまでです。");
  if (pages.reduce((sum, page) => sum + page.length, 0) > 10_000_000) throw Error("文字数の合計が1000万文字を超えました。");
  const files: Record<string, Uint8Array> = {};
  const strings: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${pages.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${pages.map((_, i) => `<sheet name="ページ${pageNumbers[i]}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  };
  pages.forEach((page, i) => {
    const lines = page.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 50_000) throw Error("Excelへの書き出しは1ページ5万行までです。");
    if (lines.some(line => line.length > 32_767)) throw Error("Excelへの書き出しは1行32767文字までです。");
    const rows = lines.map((line, n) => `<row r="${n + 1}"><c r="A${n + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlText(line)}</t></is></c></row>`).join("");
    strings[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  for (const [name, contents] of Object.entries(strings)) files[name] = strToU8(contents);
  return zipSync(files, { level: 6 });
}
