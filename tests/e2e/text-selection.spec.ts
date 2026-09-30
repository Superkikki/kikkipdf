import { test, expect } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  degrees,
} from "pdf-lib";
import { readFile } from "node:fs/promises";

test("selects portions of multiple text lines and saves standard markup with one undo", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([420, 595]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText("Select this first line", { x: 40, y: 520, size: 16, font });
  sheet.drawText("Second line to annotate", { x: 40, y: 490, size: 16, font });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "selection.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  const spans = page.locator(
    ".viewer-scroll .textLayer span:not(.markedContent)",
  );
  await expect(spans).toHaveCount(2);
  const select = async () => {
    await spans.evaluateAll((elements) => {
      const range = document.createRange();
      range.setStart(elements[0].firstChild!, 7);
      range.setEnd(elements[1].firstChild!, 11);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  };
  const tools = page.getByRole("toolbar", { name: "選択文字への注釈" });
  await select();
  await expect(tools).toBeVisible();
  await tools.getByRole("button", { name: "蛍光ペン", exact: true }).click();
  await expect(tools).toHaveCount(0);
  await page.keyboard.press("Control+z");
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const undone = info.outputPath("undo.pdf");
  await (await download).saveAs(undone);
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  const without = await PDFDocument.load(await readFile(undone));
  expect(without.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.keyboard.press("Control+y");
  // Start a browser selection, then apply both remaining annotation kinds.
  for (const label of ["下線", "取り消し線"]) {
    await select();
    await expect(tools).toBeVisible();
    await tools.getByRole("button", { name: label, exact: true }).click();
  }
  // Annotation comments must not double-count source text in page search.
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByLabel("PDF内を検索").fill("Second line");
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("selected-markup.pdf");
  await (await download).saveAs(saved);
  const out = await PDFDocument.load(await readFile(saved));
  const annotations = out.getPage(0).node.Annots()!;
  expect(annotations.size()).toBe(6);
  const sourceWidth = font.widthOfTextAtSize("this first line", 16);
  for (let i = 0; i < 6; i++) {
    const annotation = annotations.lookup(i, PDFDict);
    expect(annotation.get(PDFName.of("Subtype"))?.toString()).toBe(
      `/${["Highlight", "Underline", "StrikeOut"][Math.floor(i / 2)]}`,
    );
    expect(
      annotation.lookup(PDFName.of("Contents"), PDFHexString).decodeText(),
    ).toBe(i % 2 === 0 ? "this first line" : "Second line");
    const quad = annotation
      .lookup(PDFName.of("QuadPoints"), PDFArray)
      .asArray()
      .map((v) => Number(v.toString()));
    if (i % 2 === 0) {
      expect(quad[2] - quad[0]).toBeCloseTo(sourceWidth, 0);
      expect(quad[0]).toBeCloseTo(
        40 + font.widthOfTextAtSize("Select ", 16),
        0,
      );
    }
  }
  await page.screenshot({
    path: info.outputPath("selected-text-annotations.png"),
  });
  expect(errors).toEqual([]);
});

test("mouse selection remains aligned on a rotated cropped page", async ({
  page,
}, info) => {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([420, 595]);
  sheet.drawText("Mouse text selection", { x: 40, y: 490, size: 16 });
  sheet.setCropBox(20, 30, 350, 535);
  sheet.setRotation(degrees(90));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "rotated-selection.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  const span = page.locator(".viewer-scroll .textLayer span").first();
  await expect(span).toContainText("Mouse");
  const rect = await span.boundingBox();
  if (!rect) throw Error("Missing rotated text region");
  // A 90-degree page rotates the horizontal text's reading direction downward.
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 1);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 1, {
    steps: 12,
  });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toBe("Mouse text selection");
  await page
    .getByRole("toolbar", { name: "選択文字への注釈" })
    .getByRole("button", { name: "下線", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("rotated-underline.pdf");
  await (await download).saveAs(saved);
  const output = await PDFDocument.load(await readFile(saved));
  const annotation = output.getPage(0).node.Annots()!.lookup(0, PDFDict);
  expect(annotation.get(PDFName.of("Subtype"))).toBe(PDFName.of("Underline"));
  const quad = annotation
    .lookup(PDFName.of("QuadPoints"), PDFArray)
    .asArray()
    .map((v) => Number(v.toString()));
  expect(quad[0]).toBeCloseTo(40, 0);
  expect(quad[2]).toBeCloseTo(
    40 +
      (await pdf.embedFont(StandardFonts.Helvetica)).widthOfTextAtSize(
        "Mouse text selection",
        16,
      ),
    0,
  );
  expect(quad[1]).toBeGreaterThan(490);
  expect(quad[5]).toBeLessThan(490);
});
