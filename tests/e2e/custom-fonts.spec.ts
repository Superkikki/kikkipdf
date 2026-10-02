import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject, openProject } from "../../src/state/project";
const fontPath =
  "public/assets/pdfjs/standard_fonts/LiberationSans-Regular.ttf";
test("registers a local TTF, previews its glyphs, undoes, saves PDF and reopens editable fonts", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const d = emptyDocument("custom.pdf");
  d.pages = [blankPage()];
  const o = {
    ...newObject("text", 40, 80),
    text: "Local custom font wraps text across lines",
    width: 145,
    height: 120,
  };
  d.pages[0].objects = [o];
  await page.goto("/");
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "custom.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(d)),
  });
  const text = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(text).toBeVisible();
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "フォントを追加", exact: true })
    .click();
  await (await chooser).setFiles(fontPath);
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    /^font-/,
  );
  await expect(text).toHaveAttribute("font-family", /^Kikki[a-f0-9]{64}$/);
  const fontId = await page
    .getByLabel("フォント", { exact: true })
    .inputValue();
  const family = await text.getAttribute("font-family");
  expect(
    await page.evaluate(
      (family) => document.fonts.check(`18px ${family}`),
      family,
    ),
  ).toBe(true);
  const lines = await text.locator("tspan").allTextContents();
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join("")).toBe(o.text);
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    "japanese",
  );
  await expect(
    page
      .getByLabel("フォント", { exact: true })
      .locator(`option[value='${fontId}']`),
  ).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(text).toHaveAttribute("font-family", family!);
  // Duplicate registration reuses the asset rather than growing the project.
  chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "フォントを追加", exact: true })
    .click();
  await (await chooser).setFiles(fontPath);
  await expect(
    page
      .getByLabel("フォント", { exact: true })
      .locator(`option[value='${fontId}']`),
  ).toHaveCount(1);
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("custom.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.keys(restored.fonts ?? {})).toEqual([fontId]);
  expect(restored.fonts![fontId].bytes).toEqual(
    new Uint8Array(await readFile(fontPath)),
  );
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const pdf = info.outputPath("custom.pdf");
  await (await download).saveAs(pdf);
  await page.reload();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(pdf);
  const layer = page.locator(".viewer-scroll .textLayer").first();
  await expect(layer).toContainText("Local custom");
  expect(
    (await layer.locator("span:not(.markedContent)").allTextContents()).map(
      (s) => s.trim(),
    ),
  ).toEqual(lines.map((s) => s.trim()));
  const ink = await page
    .locator(".viewer-scroll .page-view canvas")
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180)
          count++;
      return count;
    });
  expect(ink).toBeGreaterThan(500);
  await page.reload();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(project);
  await expect(text).toHaveAttribute("font-family", family!);
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  await page
    .getByLabel("テキスト内容")
    .fill("Reopened custom font edited successfully");
  await expect(text).toContainText("Reopened");
  await page.screenshot({ path: info.outputPath("custom-font.png") });
  expect(errors).toEqual([]);
});

test("rejects invalid fonts without changing the selected text or undo history", async ({
  page,
}) => {
  const d = emptyDocument();
  d.pages = [blankPage()];
  d.pages[0].objects = [
    { ...newObject("text", 40, 80), text: "Keep original" },
  ];
  await page.goto("/");
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "original.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(d)),
  });
  const text = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(text).toBeVisible();
  await page.locator(".viewer-scroll .object-layer > g").first().click();
  chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "フォントを追加", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "broken.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.alloc(20),
  });
  await expect(page.getByRole("alert")).toContainText("TTF");
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue(
    "japanese",
  );
  await expect(
    page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }),
  ).toBeDisabled();
});
