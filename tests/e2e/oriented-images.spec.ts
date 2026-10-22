import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../../src/direct/content";

for (const kind of ["quarter-turn-form", "reflection"] as const) {
  test(`moves, resizes, deletes and saves ${kind} images while preserving pixel orientation and shared neighbours`, async ({ page }, info) => {
    await page.goto("/");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 16;
      const context = canvas.getContext("2d")!;
      for (const [color, x, y] of [["#ff0000", 0, 0], ["#00ff00", 12, 0], ["#0000ff", 0, 8], ["#ffff00", 12, 8]] as const) {
        context.fillStyle = color; context.fillRect(x, y, 12, 8);
      }
      return canvas.toDataURL().split(",")[1];
    });
    const inner = await PDFDocument.create(), sheet = inner.addPage([420, 400]), image = await inner.embedPng(Buffer.from(png, "base64"));
    await inner.flush();
    sheet.node.set(PDFName.of("Resources"), inner.context.obj({ XObject: { Im: image.ref } }));
    const matrix = kind === "reflection" ? "-80 0 0 40 130 220" : "0 80 -40 0 110 180";
    sheet.node.set(PDFName.of("Contents"), inner.context.register(inner.context.flateStream(
      `q ${matrix} cm /Im Do Q` + (kind === "reflection" ? " q -80 0 0 40 130 100 cm /Im Do Q" : ""))));
    let bytes = await inner.save();
    if (kind === "quarter-turn-form") {
      const input = await PDFDocument.load(bytes), outer = await PDFDocument.create(), page = outer.addPage([420, 400]);
      const form = await outer.embedPage(input.getPage(0)); page.drawPage(form); page.drawPage(form, { y: -120 }); bytes = await outer.save();
    }
    const runs = (await inspectDirectText(bytes, 0)).images!; expect(runs).toHaveLength(2);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
    await (await chooser).setFiles({ name: "oriented.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
    const colors = async (box: { x: number; y: number; width: number; height: number }) => {
      await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
      return page.locator(".viewer-scroll canvas").evaluate((canvas: HTMLCanvasElement, b) =>
        [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) => Array.from(canvas.getContext("2d")!.getImageData(
          Math.round((b.x + b.width * x) * canvas.width / 420), Math.round((b.y + b.height * y) * canvas.height / 400), 1, 1).data).slice(0, 3)), box);
    };
    const original = await colors(runs[0]), neighbour = await colors(runs[1]);
    expect(new Set(original.map(color => color.join(","))).size).toBe(4);
    await page.getByRole("button", { name: "ツール", exact: true }).click(); await page.getByRole("button", { name: "既存画像", exact: true }).click();
    await page.getByRole("button", { name: "既存画像 1", exact: true }).dblclick();
    for (const [key, value] of Object.entries({ x: 160, y: 160, width: 90, height: 60 })) await page.getByLabel(key, { exact: true }).fill(String(value));
    const target = { x: 160, y: 160, width: 90, height: 60 };
    await expect.poll(() => colors(target)).toEqual(original); expect(await colors(runs[1])).toEqual(neighbour);
    await page.getByRole("button", { name: "削除", exact: true }).click();
    await expect.poll(() => colors(target)).toEqual(Array.from({ length: 4 }, () => [255, 255, 255]));
    await page.keyboard.press("Control+z"); await expect.poll(() => colors(target)).toEqual(original);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
    const output = info.outputPath("oriented-saved.pdf"); await (await download).saveAs(output);
    const saved = await readFile(output), after = (await inspectDirectText(new Uint8Array(saved), 0)).images!;
    expect(after[0]).toMatchObject(target); expect(after[1]).toMatchObject({ x: runs[1].x, y: runs[1].y, width: runs[1].width, height: runs[1].height });
    await page.reload(); const reopen = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
    await (await reopen).setFiles({ name: "saved.pdf", mimeType: "application/pdf", buffer: saved });
    await expect.poll(() => colors(target)).toEqual(original); expect(await colors(runs[1])).toEqual(neighbour); expect(errors).toEqual([]);
  });
}
