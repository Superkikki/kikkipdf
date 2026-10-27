import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { addBatesNumbers, type BatesOptions } from "../../src/pages/bates";
import { saveProject } from "../../src/state/project";

test("saved Japanese and numeric text remains searchable after reopening", async ({ page }, info) => {
  const model = emptyDocument(); model.pages = [blankPage(), blankPage()];
  model.pages[0].objects = [{ ...newObject("text", 40, 50), text: "CASE-098 日本語", width: 400, wrap: false }];
  model.pages[1].objects = [{ ...newObject("text", 40, 50), text: "0123456789 English", width: 400, wrap: false }];
  const options: BatesOptions = { range: "1", prefix: "案件-", suffix: "", start: 98, digits: 3, position: "bottom-right", margin: 24, fontSize: 11, color: "#000000" };
  const numbered = addBatesNumbers(model, options).apply(model);
  await page.goto("/"); await page.keyboard.press("Escape"); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "unicode.kpdf", mimeType: "application/zip", buffer: Buffer.from(await saveProject(numbered)) });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click(); const path = info.outputPath("unicode.pdf"); await (await download).saveAs(path);
  const data = Array.from(await readFile(path));
  const texts = await page.evaluate(async bytes => {
    const modulePath = "/src/viewer/pdf.ts"; const { sourcePdf } = await import(modulePath) as typeof import("../../src/viewer/pdf");
    const doc = await sourcePdf({ id: crypto.randomUUID(), name: "unicode.pdf", bytes: new Uint8Array(bytes) });
    const result = []; let firstWidth = 0; for (let i = 1; i <= 2; i++) { const content = await (await doc.getPage(i)).getTextContent(); const items = content.items.filter(item => "str" in item); result.push(items.map(item => "str" in item ? item.str : "").join("")); if (i === 1) { const first = items.find(item => "str" in item && item.str.startsWith("CASE-")); if (first && "width" in first) firstWidth = first.width; } }
    await doc.loadingTask.destroy(); return { result, firstWidth };
  }, data);
  expect(texts.result[0]).toContain("CASE-098 日本語"); expect(texts.result[0]).toContain("案件-098"); expect(texts.result[1]).toBe("0123456789 English");
  const font = fontkit.create(new Uint8Array(await readFile("public/assets/NotoSansJP-Regular.otf")));
  const expectedWidth = font.layout("CASE-098 日本語").glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) / font.unitsPerEm * 18;
  expect(texts.firstWidth).toBeCloseTo(expectedWidth, 1);
});
