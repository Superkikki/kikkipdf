import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject } from "../../src/state/project";
import { recognitionGeometry } from "../../src/ocr/geometry";

test("OCR search follows scanned glyphs across crop, rotation, zoom and project saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  const scan = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 420; canvas.height = 595;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 420, 595);
    ctx.font = "24px Arial"; ctx.fillStyle = "black";
    const glyphs = [{ text: "W", x: 70 }, { text: "i", x: 260 }].map(({text, x}) => {
      ctx.fillText(text, x, 160);
      const m = ctx.measureText(text);
      return { text, bbox: { x0: x - m.actualBoundingBoxLeft, y0: 160 - m.actualBoundingBoxAscent,
        x1: x + m.actualBoundingBoxRight, y1: 160 + m.actualBoundingBoxDescent } };
    });
    return { image: canvas.toDataURL("image/png"), glyphs };
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([420, 595]).drawImage(await pdf.embedPng(scan.image), { x: 0, y: 0, width: 420, height: 595 });
  const model = emptyDocument("ocr-position.pdf");
  model.sources.s = { id: "s", name: model.name, bytes: await pdf.save() };
  const x0 = scan.glyphs[0].bbox.x0, x1 = scan.glyphs[1].bbox.x1;
  const y0 = Math.min(...scan.glyphs.map(g => g.bbox.y0)), y1 = Math.max(...scan.glyphs.map(g => g.bbox.y1));
  model.pages = [{ ...blankPage(), width: 420, height: 595, sourceId: "s", sourceIndex: 0,
    crop: { x: 20, y: 30, width: 360, height: 500 }, rotation: 90,
    objects: [{ ...newObject("ocr", x0, y0), text: "W i", width: x1 - x0, height: y1 - y0,
      font: "sans", opacity: 0, ocrGeometry: recognitionGeometry({ text: "W i", bbox: { x0, y0, x1, y1 },
        words: scan.glyphs.map(g => ({ ...g, symbols: [g] })) }) }] }];
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "ocr.kpdf", mimeType: "application/zip", buffer: Buffer.from(await saveProject(model)) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
  await page.getByRole("button", { name: "検索", exact: true }).click();
  const search = page.getByLabel("PDF内を検索");
  await search.fill("i");
  const match = page.locator(".search-object-highlights rect.search-match");
  await expect(match).toHaveCount(1);
  const expected = scan.glyphs[1].bbox;
  for (const [attribute, value] of Object.entries({ x: expected.x0, y: expected.y0,
    width: expected.x1 - expected.x0, height: expected.y1 - expected.y0 })) {
    expect(Number(await match.getAttribute(attribute))).toBeCloseTo(value, 4);
  }
  await page.getByLabel("ズーム", { exact: true }).selectOption("1");
  const first = (await match.boundingBox())!;
  await page.getByLabel("ズーム", { exact: true }).selectOption("1.5");
  await expect.poll(async () => (await match.boundingBox())!.width / first.width).toBeCloseTo(1.5, 2);
  const enlarged = (await match.boundingBox())!;
  expect(enlarged.height / first.height).toBeCloseTo(1.5, 2);
  await search.press("Enter");
  await expect(match).toHaveClass(/current-search-match/);
  await page.getByRole("button", { name: "検索をクリア", exact: true }).click();
  await expect(match).toHaveCount(0);
  expect(errors).toEqual([]);
});
