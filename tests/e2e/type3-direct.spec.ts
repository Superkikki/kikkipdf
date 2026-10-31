import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { type3Fixture } from "../fixtures/type3";
import { inspectDirectText } from "../../src/direct/content";

for (const sample of [
  { label: "glyph names", text: "AB", unicode: undefined },
  { label: "ToUnicode Japanese", text: "日本", unicode: "2 beginbfchar <41> <65E5> <42> <672C> endbfchar" },
]) test(`edits Type 3 ${sample.label} without shifting following content`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const input = await type3Fixture({ unicode: sample.unicode }), before = await inspectDirectText(input, 0);
  await page.goto("/"); await page.keyboard.press("Escape"); const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles({ name: "type3.pdf", mimeType: "application/pdf", buffer: Buffer.from(input) });
  const text = page.locator(".viewer-scroll .textLayer span").filter({ hasText: sample.text }).first(); await expect(text).toBeVisible(); await text.dblclick();
  const editor = page.getByRole("textbox", { name: "ページ上のテキスト編集", exact: true }); await expect(editor).toBeFocused(); await editor.fill("Changed"); await editor.press("Enter");
  const download = page.waitForEvent("download"); await page.keyboard.press("Control+s"); const file = info.outputPath("type3-edited.pdf"); await (await download).saveAs(file);
  const after = await inspectDirectText(await readFile(file), 0); expect(after.runs.some(run => run.text === sample.text)).toBe(false); expect(after.runs.some(run => run.text === "Changed")).toBe(true);
  expect(after.runs.find(run => run.text === " Neighbour")!.x).toBeCloseTo(before.runs.find(run => run.text === " Neighbour")!.x, 7); expect(errors).toEqual([]);
});
