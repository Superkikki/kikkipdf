import { test, expect } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { readFile } from "node:fs/promises";

test("changes layer visibility in bulk with undo, lock protection and a PDF round trip", async ({ page }, info) => {
  const pdf = await PDFDocument.create(); pdf.addPage([420, 595]);
  const groups = ["A", "B", "Locked"].map(name => pdf.context.register(pdf.context.obj({ Type: "OCG", Name: PDFString.of(name) })));
  pdf.catalog.set(PDFName.of("OCProperties"), pdf.context.obj({ OCGs: groups,
    D: { BaseState: "ON", OFF: [groups[1]], Locked: [groups[2]], Order: groups } }));
  await page.goto("/"); await page.keyboard.press("Escape");
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "bulk.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "レイヤー", exact: true }).click();
  const panel = page.locator(".layer-panel"), a = panel.getByRole("checkbox", { name: "A", exact: true }),
    b = panel.getByRole("checkbox", { name: "B", exact: true }), locked = panel.getByRole("checkbox", { name: "Locked", exact: true });
  await expect(a).toBeChecked(); await expect(b).not.toBeChecked(); await expect(locked).toBeDisabled();
  await panel.getByRole("button", { name: "すべて非表示", exact: true }).click();
  await expect(a).not.toBeChecked(); await expect(b).not.toBeChecked(); await expect(locked).toBeChecked();
  await page.keyboard.press("Control+z"); await expect(a).toBeChecked(); await expect(b).not.toBeChecked();
  await panel.getByRole("button", { name: "表示を反転", exact: true }).click();
  await expect(a).not.toBeChecked(); await expect(b).toBeChecked(); await expect(locked).toBeChecked();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click();
  const output = info.outputPath("bulk.pdf"); await (await download).saveAs(output);
  const saved = await PDFDocument.load(await readFile(output));
  const props = saved.catalog.lookup(PDFName.of("OCProperties"), PDFDict), all = props.lookup(PDFName.of("OCGs"), PDFArray);
  const off = props.lookup(PDFName.of("D"), PDFDict).lookup(PDFName.of("OFF"), PDFArray);
  expect(off.asArray().map(ref => saved.context.lookup(ref, PDFDict).lookup(PDFName.of("Name"), PDFString).decodeText())).toEqual(["A"]);
  expect(all.size()).toBe(3);
  await panel.getByRole("button", { name: "すべて表示", exact: true }).click();
  await expect(a).toBeChecked(); await expect(b).toBeChecked(); await expect(locked).toBeChecked();
});
