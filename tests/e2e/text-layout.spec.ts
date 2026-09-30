import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject, openProject } from "../../src/state/project";

test("wraps Japanese and English, adjusts height, undoes changes, and preserves saved lines", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const model = emptyDocument("text-box.pdf");
  model.pages = [blankPage()];
  const object = {
    ...newObject("text", 50, 100),
    text: "日本語の文章を、幅に合わせて折り返します。 English words wrap as well.",
    width: 150,
    height: 10,
    fontSize: 16,
    align: "right" as const,
  };
  model.pages[0].objects = [object];
  await page.goto("/");
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "text-box.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(model)),
  });
  const text = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(text).toBeVisible();
  await text.click();
  await expect(page.getByLabel("幅に合わせて折り返す")).toBeChecked();
  await expect(page.locator(".text-overflow-warning")).toBeVisible();
  await page.getByLabel("行間", { exact: true }).fill("1.6");
  await expect(page.locator(".text-layout-summary")).toContainText("行");
  const lines = await text.locator("tspan").allTextContents();
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.join("")).toBe(object.text);
  const widths = await text
    .locator("tspan")
    .evaluateAll((elements) =>
      elements.map((el) => Number(el.getAttribute("textLength"))),
    );
  expect(widths.every((width) => width <= object.width + 0.001)).toBe(true);
  const baselines = await text
    .locator("tspan")
    .evaluateAll((elements) =>
      elements.map((el) => Number(el.getAttribute("y"))),
    );
  expect(baselines[1] - baselines[0]).toBeCloseTo(25.6);
  await page
    .getByRole("button", { name: "文字に合わせて高さを調整", exact: true })
    .click();
  await expect(page.locator(".text-overflow-warning")).toHaveCount(0);
  const height = Number(
    await page.getByLabel("height", { exact: true }).inputValue(),
  );
  expect(height).toBeGreaterThan(80);
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("height", { exact: true })).toHaveValue("10");
  await page.keyboard.press("Control+y");
  await expect(page.getByLabel("height", { exact: true })).toHaveValue(
    String(height),
  );
  await page.screenshot({ path: info.outputPath("text-box.png") });
  let download = page.waitForEvent("download");
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page
    .getByRole("button", { name: "編集プロジェクトを保存", exact: true })
    .click();
  const project = info.outputPath("text-box.kpdf");
  await (await download).saveAs(project);
  const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(restored.pages[0].objects[0]).toMatchObject({
    wrap: true,
    lineHeight: 1.6,
    height,
    text: object.text,
  });
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("text-box.pdf");
  await (await download).saveAs(saved);
  await page.reload();
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(saved);
  const sourceText = page.locator(".viewer-scroll .textLayer").first();
  await expect(sourceText).toContainText("日本語");
  const content = await sourceText
    .locator("span:not(.markedContent)")
    .allTextContents();
  expect(content.map((line) => line.trim())).toEqual(
    lines.map((line) => line.trim()),
  );
  // Text extraction can succeed even when an embedded font is corrupt.
  // Verify actual ink in every non-space character cell of the saved PDF.
  const emptyGlyphs = await sourceText.evaluate((layer) => {
    const canvas = layer.closest(".page-view")!.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width,
      scaleY = canvas.height / bounds.height;
    const missing: string[] = [];
    for (const span of layer.querySelectorAll("span:not(.markedContent)")) {
      const node = span.firstChild;
      if (!node) continue;
      const value = node.textContent ?? "";
      for (let i = 0; i < value.length; i++) {
        if (!value[i].trim()) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        const x = Math.max(0, Math.floor((rect.left - bounds.left) * scaleX));
        const y = Math.max(0, Math.floor((rect.top - bounds.top) * scaleY));
        const w = Math.max(
          1,
          Math.min(canvas.width - x, Math.ceil(rect.width * scaleX)),
        );
        const h = Math.max(
          1,
          Math.min(canvas.height - y, Math.ceil(rect.height * scaleY)),
        );
        const pixels = context.getImageData(x, y, w, h).data;
        let ink = 0;
        for (let p = 0; p < pixels.length; p += 4)
          if (pixels[p] < 180 && pixels[p + 1] < 180 && pixels[p + 2] < 180)
            ink++;
        if (ink < 3) missing.push(value[i]);
      }
    }
    return missing;
  });
  await page.screenshot({ path: info.outputPath("saved-text-box.png") });
  expect(emptyGlyphs).toEqual([]);
  expect(errors).toEqual([]);
});

test("preserves legacy unwrapped text and reflows when width or font changes", async ({
  page,
}) => {
  const model = emptyDocument();
  model.pages = [blankPage()];
  const object = {
    ...newObject("text", 50, 80),
    text: "Legacy text stays on one line",
    font: "sans" as const,
    width: 95,
    wrap: undefined,
    lineHeight: undefined,
  };
  model.pages[0].objects = [object];
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "legacy.kpdf",
    mimeType: "application/zip",
    buffer: Buffer.from(await saveProject(model)),
  });
  const text = page.locator(
    ".viewer-scroll .editable-text[data-layout-ready=true]",
  );
  await expect(text.locator("tspan")).toHaveCount(1);
  await text.click();
  await expect(page.getByLabel("幅に合わせて折り返す")).not.toBeChecked();
  await page.getByLabel("幅に合わせて折り返す").check();
  await expect.poll(() => text.locator("tspan").count()).toBeGreaterThan(1);
  await page.getByLabel("width", { exact: true }).fill("400");
  await expect(text.locator("tspan")).toHaveCount(1);
  await page.getByLabel("フォント", { exact: true }).selectOption("mono");
  await expect(text).toHaveAttribute("font-family", "Courier New, monospace");
  await page.getByLabel("width", { exact: true }).fill("95");
  await expect.poll(() => text.locator("tspan").count()).toBeGreaterThan(1);
  expect((await text.locator("tspan").allTextContents()).join("")).toBe(
    object.text,
  );
});
