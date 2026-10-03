import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";

async function fixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const group = pdf.context.register(pdf.context.obj({
    Type: "OCG", Name: PDFString.of("Hidden artwork"), Intent: ["View"],
  }));
  const properties = pdf.context.obj({ Hidden: group });
  page.node.set(PDFName.of("Resources"), pdf.context.obj({ Properties: properties }));
  page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.flateStream(
    "q 0 0.7 0 rg 150 150 60 60 re f Q /OC /Hidden BDC q 1 0 0 rg 50 150 60 60 re f Q EMC",
  )));
  const defaultConfig = pdf.context.register(pdf.context.obj({
    BaseState: "ON", OFF: [group], Intent: ["View"],
  }));
  pdf.catalog.set(PDFName.of("OCProperties"), pdf.context.register(pdf.context.obj({
    OCGs: [group], D: defaultConfig,
  })));
  return Buffer.from(await pdf.save());
}

async function widgetFixture() {
  const input = await PDFDocument.load(await fixture());
  const optional = input.context.lookup(input.catalog.get(PDFName.of("OCProperties"))!, PDFDict);
  const group = optional.lookup(PDFName.of("OCGs"), PDFArray).get(0);
  const field = input.getForm().createTextField("Layer field");
  field.addToPage(input.getPage(0), { x: 40, y: 40, width: 180, height: 24 });
  field.acroField.getWidgets()[0].dict.set(PDFName.of("OC"), group);
  return Buffer.from(await input.save());
}

async function pixel(page: import("@playwright/test").Page, x: number, y: number) {
  const canvas = page.locator(".viewer-scroll canvas").first();
  await expect(canvas).toBeVisible();
  return canvas.evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    return Array.from(canvas.getContext("2d")!.getImageData(
      Math.round(point.x * canvas.width / 300), Math.round(point.y * canvas.height / 300), 1, 1,
    ).data).slice(0, 3);
  }, { x, y });
}

async function openPdf(page: import("@playwright/test").Page, bytes: Buffer, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: bytes });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
}

test("keeps hidden optional-content artwork invisible after saving and reopening", async ({ page }, info) => {
  const original = await fixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openPdf(page, original, "hidden-layer.pdf");
  const hiddenBefore = await pixel(page, 80, 120);
  const visibleBefore = await pixel(page, 180, 120);
  hiddenBefore.forEach((channel) => expect(channel).toBeGreaterThan(240));
  expect(visibleBefore[0]).toBeLessThan(30);
  expect(visibleBefore[1]).toBeGreaterThan(150);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("hidden-layer-export.pdf");
  await (await download).saveAs(output);
  await page.reload();
  await openPdf(page, await readFile(output), "hidden-layer-export.pdf");
  const hiddenAfter = await pixel(page, 80, 120);
  const visibleAfter = await pixel(page, 180, 120);
  hiddenAfter.forEach((channel) => expect(channel).toBeGreaterThan(240));
  expect(visibleAfter[0]).toBeLessThan(30);
  expect(visibleAfter[1]).toBeGreaterThan(150);

  expect(errors).toEqual([]);
  const savedPdf = await PDFDocument.load(await readFile(output));
  const oc = savedPdf.context.lookup(savedPdf.catalog.get(PDFName.of("OCProperties"))!, PDFDict);
  expect(oc.lookup(PDFName.of("OCGs"), PDFArray).size()).toBe(1);
});

test("layer visibility updates the rendered page, supports undo and survives PDF export", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openPdf(page, await fixture(), "toggle-layer.pdf");
  await page.getByRole("button", { name: "レイヤー", exact: true }).click();
  const layer = page.getByRole("checkbox", { name: "Hidden artwork" });
  await expect(layer).not.toBeChecked();
  const before = await pixel(page, 80, 120);
  before.forEach((channel) => expect(channel).toBeGreaterThan(240));

  await layer.check();
  await expect.poll(() => pixel(page, 80, 120).then((rgb) => rgb[0] > 180 && rgb[1] < 100)).toBe(true);
  await page.getByTitle("元に戻す (Ctrl+Z)").click();
  await expect(layer).not.toBeChecked();
  await expect.poll(() => pixel(page, 80, 120).then((rgb) => rgb.every((channel) => channel > 240))).toBe(true);
  await page.keyboard.press("Control+y");
  await expect(layer).toBeChecked();
  await expect.poll(() => pixel(page, 80, 120).then((rgb) => rgb[0] > 180 && rgb[1] < 100)).toBe(true);
  await page.screenshot({ path: info.outputPath("layers-panel.png") });
  await page.getByRole("button", { name: "初期表示に戻す", exact: true }).click();
  await expect(layer).not.toBeChecked();
  await expect.poll(() => pixel(page, 80, 120).then((rgb) => rgb.every((channel) => channel > 240))).toBe(true);
  await page.keyboard.press("Control+z");
  await expect(layer).toBeChecked();
  await expect.poll(() => pixel(page, 80, 120).then((rgb) => rgb[0] > 180 && rgb[1] < 100)).toBe(true);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("visible-layer-export.pdf");
  await (await download).saveAs(output);
  await page.reload();
  await openPdf(page, await readFile(output), "visible-layer-export.pdf");
  const after = await pixel(page, 80, 120);
  expect(after[0]).toBeGreaterThan(180);
  expect(after[1]).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test("hides and restores a form overlay with its optional-content group", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, await widgetFixture(), "layered-form.pdf");
  await page.getByRole("button", { name: "レイヤー", exact: true }).click();
  const layer = page.getByRole("checkbox", { name: "Hidden artwork" });
  await expect(layer).not.toBeChecked();
  const field = page.locator(".viewer-scroll .imported-form-controls").getByRole("textbox", { name: "Layer field", exact: true });
  await expect(field).toHaveCount(0);

  await layer.check();
  await expect(field).toBeVisible();
  await layer.uncheck();
  await expect(field).toHaveCount(0);
});
