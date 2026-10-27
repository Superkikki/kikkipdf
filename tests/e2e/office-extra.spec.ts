import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

async function openFixture(page: Page) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([420, 595]).drawText("First page & details", { x: 40, y: 520, font, size: 20 });
  pdf.addPage([595, 420]).drawText("=1+1 second page", { x: 40, y: 300, font, size: 20 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
}

for (const format of ["Excel", "PowerPoint"] as const) {
  test(`exports selected PDF pages to ${format}`, async ({ page, context }, info) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    context.on("request", request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:1420")) external.push(request.url());
    });
    await openFixture(page);
    await page.getByRole("button", { name: "テキスト", exact: true }).click();
    const bounds = await page.locator(".viewer-scroll .page-view").first().boundingBox();
    if (!bounds) throw Error("missing page");
    await page.mouse.click(bounds.x + 90, bounds.y + 170);
    await page.getByLabel("テキスト内容").fill("追加した日本語");
    const name = format === "Excel" ? "Excel形式で書き出し（テキスト）" : "PowerPoint形式で書き出し（画像）";
    await page.locator(".menu > summary").filter({ hasText: "ファイル" }).click();
    await page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog", { name });
    await page.getByLabel("ページ範囲（空欄は全ページ）").fill("2,1");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "書き出し", exact: true }).click();
    const file = await download;
    const filename = format === "Excel" ? "output.xlsx" : "output.pptx";
    await file.saveAs(info.outputPath(filename));
    const files = unzipSync(await readFile(info.outputPath(filename)));
    if (format === "Excel") {
      const workbook = strFromU8(files["xl/workbook.xml"]);
      expect(workbook.indexOf("ページ2")).toBeLessThan(workbook.indexOf("ページ1"));
      const first = strFromU8(files["xl/worksheets/sheet1.xml"]);
      expect(first).toContain("=1+1 second page");
      expect(first).toContain('t="inlineStr"');
      expect(first).not.toContain("<f>");
      expect(strFromU8(files["xl/worksheets/sheet2.xml"])).toContain("First page &amp; details");
      expect(strFromU8(files["xl/worksheets/sheet2.xml"])).toContain("追加した日本語");
    } else {
      expect(Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2);
      const images = Object.keys(files).filter(n => /^ppt\/media\/image/.test(n));
      expect(images).toHaveLength(2);
      for (const image of images) expect(Array.from(files[image].slice(0, 3))).toEqual([255, 216, 255]);
    }
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

for (const name of ["Excel形式で書き出し（テキスト）", "PowerPoint形式で書き出し（画像）"]) {
  test(`blocks ${name} when redaction is pending`, async ({ page }) => {
    await openFixture(page);
    await page.getByRole("button", { name: "ツール", exact: true }).click();
    await page.getByRole("button", { name: "墨消し候補", exact: true }).click();
    const bounds = await page.locator(".viewer-scroll .page-view").first().boundingBox();
    if (!bounds) throw Error("missing page");
    await page.mouse.move(bounds.x + 30, bounds.y + 45); await page.mouse.down();
    await page.mouse.move(bounds.x + 300, bounds.y + 130); await page.mouse.up();
    await page.locator(".menu > summary").filter({ hasText: "ファイル" }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("墨消し候補が残っています");
  });
}
