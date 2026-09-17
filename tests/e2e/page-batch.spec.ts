import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
test("rotates a range with one undo, then splits the edited PDF into a single ZIP", async ({
  page,
}, info) => {
  const source = await PDFDocument.create();
  for (let i = 0; i < 5; i++) source.addPage([300 + i * 10, 400]);
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "batch.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "一括操作", exact: true }).click();
  await page.getByLabel("ページ範囲（空欄は全ページ）").fill("1,3-5");
  await page.getByLabel("操作", { exact: true }).selectOption("左に90°回転");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  await expect(page.locator(".page-info")).toContainText("270°");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".page-info")).toContainText("0°");
  await page.keyboard.press("Control+y");
  await expect(page.locator(".page-info")).toContainText("270°");
  await page.getByRole("button", { name: "分割ZIP", exact: true }).click();
  await page.getByLabel("1ファイルあたりのページ数").fill("2");
  const download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  const dest = info.outputPath("split.zip");
  await (await download).saveAs(dest);
  const files = unzipSync(await readFile(dest));
  expect(Object.keys(files)).toHaveLength(3);
  const first = await PDFDocument.load(files["part-0001.pdf"]),
    last = await PDFDocument.load(files["part-0003.pdf"]);
  expect(first.getPages().map((p) => p.getRotation().angle)).toEqual([270, 0]);
  expect(last.getPageCount()).toBe(1);
  expect(last.getPage(0).getRotation().angle).toBe(270);
});
