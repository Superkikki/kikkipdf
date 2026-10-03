import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../../src/direct/content";
import { openProject } from "../../src/state/project";
async function fixture(covered = false, namedColorSpace = false) {
  const inner = await PDFDocument.create(), p = inner.addPage([420, 400]);
  p.drawRectangle({ x: 0, y: 0, width: 420, height: 400, color: rgb(0.9, 0.8, 0.7) });
  const image = await inner.embedPng(await readFile("src-tauri/icons/32x32.png"));
  p.drawImage(image, { x: 40, y: 220, width: 80, height: 40 });
  if (namedColorSpace) {
    await inner.flush();
    (inner.context.lookup(image.ref) as PDFRawStream).dict.set(PDFName.of("ColorSpace"), PDFName.of("SharedRGB"));
    p.node.Resources()!.set(PDFName.of("ColorSpace"), inner.context.obj({ SharedRGB: "DeviceRGB" }));
  }
  if (covered) p.drawRectangle({ x: 40, y: 220, width: 40, height: 40, color: rgb(0, 0, 1) });
  p.drawText("Unchanged text", { x: 30, y: 330, size: 12, font: await inner.embedFont(StandardFonts.Helvetica) });
  const source = await PDFDocument.load(await inner.save()), middle = await PDFDocument.create();
  middle.addPage([420, 400]).drawPage(await middle.embedPage(source.getPage(0)));
  const mid = await PDFDocument.load(await middle.save()), pdf = await PDFDocument.create();
  const page = pdf.addPage([420, 400]), form = await pdf.embedPage(mid.getPage(0));
  page.drawPage(form); page.drawPage(form, { y: -150 });
  return Buffer.from(await pdf.save());
}
async function open(page: Page, bytes: Buffer, name = "existing-images.pdf") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: bytes });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
}
async function imageTool(page: Page) {
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "既存画像", exact: true }).click();
}
async function pixel(page: Page, x: number, y: number) {
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
  return page.locator(".viewer-scroll canvas").evaluate((canvas: HTMLCanvasElement, p) => Array.from(
    canvas.getContext("2d")!.getImageData(Math.round(p.x * canvas.width / 420), Math.round(p.y * canvas.height / 400), 1, 1).data
  ).slice(0, 3), { x, y });
}
test("moves, resizes and deletes an existing shared image independently, preserves pixels and restores from project/PDF", async ({ page }, info) => {
  const original = await fixture();
  await page.goto("/"); await open(page, original);
  const beforePixel = await pixel(page, 80, 160);
  await imageTool(page);
  await expect(page.locator(".viewer-scroll .existing-image-layer rect")).toHaveCount(2);
  await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  await expect(page.locator(".properties")).toContainText("既存画像の位置とサイズ");
  await page.getByLabel("ズーム", { exact: true }).selectOption("1");
  const group = page.locator(".viewer-scroll .object-layer > g").first();
  const box = (await group.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("x", { exact: true })).toHaveValue("65");
  await expect(page.getByLabel("y", { exact: true })).toHaveValue("155");
  const handle = (await group.locator("rect").last().boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 20, handle.y + handle.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("width", { exact: true })).toHaveValue("100");
  await expect(page.getByLabel("height", { exact: true })).toHaveValue("50");
  await page.getByLabel("x", { exact: true }).fill("150");
  await page.getByLabel("y", { exact: true }).fill("200");
  await page.getByLabel("width", { exact: true }).fill("100");
  await page.getByLabel("height", { exact: true }).fill("60");
  const oldPixel = await pixel(page, 80, 160), newPixel = await pixel(page, 200, 230);
  expect(oldPixel).toEqual([230, 204, 178]);
  // Resampling may vary by a few values at a pixel boundary.
  newPixel.forEach((value, i) => expect(Math.abs(value - beforePixel[i])).toBeLessThan(5));
  await expect(page.locator(".viewer-scroll .textLayer")).toContainText("Unchanged text");
  const projectDownload = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("images.kpdf"); await (await projectDownload).saveAs(project);
  const loaded = await openProject(new Uint8Array(await readFile(project)));
  expect(loaded.pages[0].objects[0].sourceImage!.formPath).toHaveLength(2);
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.locator(".properties")).toContainText("元の画像を削除");
  await expect.poll(() => pixel(page, 200, 230)).toEqual([230, 204, 178]);
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect.poll(() => pixel(page, 200, 230)).toEqual(newPixel);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("moved-images.pdf"); await (await download).saveAs(output);
  const inspected = await inspectDirectText(new Uint8Array(await readFile(output)), 0);
  expect(inspected.images).toHaveLength(2);
  expect(inspected.images![0].x).toBeCloseTo(150, 5); expect(inspected.images![0].y).toBeCloseTo(200, 5);
  expect(inspected.images![0].width).toBeCloseTo(100, 5); expect(inspected.images![0].height).toBeCloseTo(60, 5);
  expect(inspected.images![1].x).toBe(40); expect(inspected.images![1].y).toBe(290);
  await page.reload(); await open(page, await readFile(project), "images.kpdf");
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  await page.getByRole("button", { name: "元の画像に戻す", exact: true }).click();
  await expect.poll(() => pixel(page, 80, 160)).toEqual(beforePixel);
  await page.reload(); await open(page, await readFile(output));
  await imageTool(page); await expect(page.locator(".existing-image-layer rect")).toHaveCount(2);
  await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await imageTool(page); await expect(page.locator(".existing-image-layer rect")).toHaveCount(1);
  await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  await page.getByRole("button", { name: "削除", exact: true }).click();
  const finalDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const final = info.outputPath("all-images-deleted.pdf"); await (await finalDownload).saveAs(final);
  expect((await inspectDirectText(new Uint8Array(await readFile(final)), 0)).images).toHaveLength(0);
  expect((await PDFDocument.load(await readFile(final))).context.enumerateIndirectObjects().some(([, value]) =>
    value instanceof PDFRawStream && value.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))).toBe(false);
});

test("replaces only a selected nested image, keeps draw order and shared occurrence, restores content and saves editable replacements", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/"); await open(page, await fixture(true));
  const red = async () => { const p = await pixel(page, 100, 145); return p[0] > 250 && p[1] < 3 && p[2] < 3; };
  const other = await pixel(page, 100, 310), first = await pixel(page, 100, 145);
  await imageTool(page); await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  const jpeg = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 4; const ctx = c.getContext("2d")!; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, 4, 4); return c.toDataURL("image/jpeg").split(",")[1]; });
  let chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "画像を差し替える", exact: true }).click();
  await (await chooser).setFiles({ name: "replacement.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg, "base64") });
  await expect(page.getByRole("button", { name: "元の画像データに戻す", exact: true })).toBeVisible();
  await expect.poll(red).toBe(true);
  expect(await pixel(page, 50, 145)).toEqual([0, 0, 255]); expect(await pixel(page, 100, 310)).toEqual(other);
  await page.getByRole("button", { name: /^元に戻す/ }).click(); await expect.poll(() => pixel(page, 100, 145)).toEqual(first);
  await page.getByRole("button", { name: /^やり直す/ }).click(); await expect.poll(red).toBe(true);
  chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "画像を差し替える", exact: true }).click();
  await (await chooser).setFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("alert")).toContainText("PNGまたはJPEG"); expect(await red()).toBe(true);
  let download = page.waitForEvent("download"); await page.locator("summary").filter({ hasText: "ファイル" }).click(); await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("replacement.kpdf"); await (await download).saveAs(project);
  const loaded = await openProject(new Uint8Array(await readFile(project))); const object = loaded.pages[0].objects[0];
  expect(loaded.images[object.imageId!].mime).toBe("image/jpeg");
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("replacement.pdf"); await (await download).saveAs(saved);
  await page.reload(); await open(page, await readFile(project), "replacement.kpdf");
  await expect.poll(red).toBe(true);
  await page.locator(".viewer-scroll .object-layer > g").first().click(); await page.getByRole("button", { name: "元の画像データに戻す", exact: true }).click();
  await expect.poll(() => pixel(page, 100, 145)).toEqual(first);
  await page.reload(); await open(page, await readFile(saved)); await expect.poll(red).toBe(true);
  expect(await pixel(page, 50, 145)).toEqual([0, 0, 255]); expect(await pixel(page, 100, 310)).toEqual(other);
  await imageTool(page); await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "画像を差し替える", exact: true }).click(); await (await chooser).setFiles("src-tauri/icons/128x128.png");
  await expect.poll(red).toBe(false); expect(errors).toEqual([]);
});

test("extracts transparent image pixels without page content, duplicates and copies across documents with undo and saved round trips", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/"); await open(page, await fixture(true, true));
  await imageTool(page); await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "画像を取り出す", exact: true }).click();
  const extracted = info.outputPath("image.png"); await (await download).saveAs(extracted);
  const actual = await readFile(extracted), original = await readFile("src-tauri/icons/32x32.png");
  const pixels = await page.evaluate(async ({ actual, original }) => {
    const read = async (data: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: canvas.width, height: canvas.height, data: Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data) };
    };
    return { actual: await read(actual), original: await read(original) };
  }, { actual: actual.toString("base64"), original: original.toString("base64") });
  expect(pixels.actual.width).toBe(32); expect(pixels.actual.height).toBe(32);
  expect(pixels.actual.data.some((n, i) => i % 4 === 3 && n === 0)).toBe(true);
  pixels.actual.data.forEach((n, i) => expect(Math.abs(n - pixels.original.data[i])).toBeLessThan(3));
  const objects = page.locator(".viewer-scroll .object-layer > g");
  await page.getByRole("button", { name: "画像を複製", exact: true }).click();
  await expect(objects).toHaveCount(2);
  await page.getByRole("button", { name: /^元に戻す/ }).click(); await expect(objects).toHaveCount(1);
  await page.getByRole("button", { name: /^やり直す/ }).click(); await expect(objects).toHaveCount(2);
  await objects.first().click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("Control+c");
  await expect(page.locator(".statusbar")).toContainText("既存画像をコピーしました");
  await page.keyboard.press("Control+x");
  await expect(page.locator(".statusbar")).toContainText("既存画像を切り取りました");
  await expect.poll(() => pixel(page, 100, 145)).toEqual([230, 204, 178]);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".unsaved-dot")).toHaveCount(1);
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name: "新規PDF", exact: true }).click();
  await page.getByRole("button", { name: "変更を破棄", exact: true }).click();
  await page.keyboard.press("Control+v"); await expect(objects).toHaveCount(1);
  await expect(objects.locator("image")).toHaveCount(1);
  await page.keyboard.press("Control+d"); await expect(objects).toHaveCount(2);
  await page.keyboard.press("Control+z"); await expect(objects).toHaveCount(1);
  download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click(); await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("copied.kpdf"); await (await download).saveAs(project);
  const model = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.keys(model.sources)).toHaveLength(0); expect(model.pages[0].objects[0].kind).toBe("image"); expect(model.pages[0].objects[0].sourceImage).toBeUndefined();
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("copied.pdf"); await (await download).saveAs(saved);
  expect((await inspectDirectText(new Uint8Array(await readFile(saved)), 0)).images).toHaveLength(1);
  await page.reload(); await open(page, await readFile(project), "copied.kpdf"); await expect(objects.locator("image")).toHaveCount(1);
  expect(errors).toEqual([]);
});
