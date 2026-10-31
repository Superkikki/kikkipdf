import { test, expect, type Page } from "@playwright/test";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject } from "../../src/state/project";

async function open(page: Page, pdf: PDFDocument) {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "search.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
  await page.keyboard.press("Control+f");
}

test("highlights exact source words, navigates within a page, keeps text selectable and clears without edits", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([420, 1200]);
  sheet.drawText("Top needle context", { x: 40, y: 1110, size: 18 });
  sheet.drawText("Bottom needle context", { x: 40, y: 110, size: 18 });
  await open(page, pdf);
  const search = page.getByLabel("PDF内を検索");
  await search.fill("needle");
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  const marks = page.locator(".viewer-scroll .textLayer mark.search-match");
  await expect(marks).toHaveText(["needle", "needle"]);
  const widths = await marks.first().evaluate(el => ({
    match: el.getBoundingClientRect().width,
    line: el.parentElement!.getBoundingClientRect().width,
  }));
  expect(widths.match).toBeLessThan(widths.line / 2);
  const span = page.locator(".viewer-scroll .textLayer span").filter({ hasText: "Top needle context" });
  await expect(span).toHaveText("Top needle context");
  await search.press("Enter");
  await search.press("Enter");
  await expect(page.locator(".search-count")).toContainText("2 / 2 件");
  const selected = page.locator(".viewer-scroll .current-search-match");
  await expect.poll(() => selected.evaluate((el) => {
    const mark = el.getBoundingClientRect(), viewer = el.closest(".viewer-scroll")!.getBoundingClientRect();
    return mark.top > viewer.top && mark.bottom < viewer.bottom;
  })).toBe(true);
  expect(await page.locator(".viewer-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(600);
  await search.press("Shift+Enter");
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  expect(await span.evaluate((el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  })).toBe("Top needle context");
  await page.getByRole("button", { name: "ページ", exact: true }).click();
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(search).toHaveValue("needle");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("searched.pdf");
  await (await download).saveAs(saved);
  const output = await PDFDocument.load(await readFile(saved));
  expect(output.getPageCount()).toBe(1);
  expect(output.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  await page.getByRole("button", { name: "検索をクリア", exact: true }).click();
  await expect(marks).toHaveCount(0);
  await expect(span).toHaveText("Top needle context");
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const { kind, unicode } of [{ kind: "text", unicode: false }, { kind: "ocr", unicode: false },
  { kind: "text", unicode: true }] as const) {
  test(`highlights each matching word inside ${unicode ? "Japanese text with emoji" : kind} instead of its entire region`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const model = emptyDocument("word-highlights.pdf");
    model.pages = [blankPage()];
    const object = { ...newObject(kind, 50, 150), text: unicode ? "前😀 needle middle needle 後" : "Before needle middle needle after",
      width: 480, height: 90, fontSize: 18, font: unicode ? "japanese" as const : "sans" as const, rotation: 12,
      opacity: kind === "ocr" ? 0 : 1 };
    model.pages[0].objects = [object];
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
    await (await chooser).setFiles({ name: "words.kpdf", mimeType: "application/zip",
      buffer: Buffer.from(await saveProject(model)) });
    await expect(page.locator(".viewer-scroll .page-view").first()).toBeVisible();
    const dirtyCount = await page.locator(".unsaved-dot").count();
    await page.keyboard.press("Control+f");
    const search = page.getByLabel("PDF内を検索");
    await search.fill("needle");
    await expect(page.locator(".search-count")).toContainText("1 / 2 件");
    const matches = page.locator(".search-object-highlights rect.search-match");
    await expect(matches).toHaveCount(2);
    const boxes = await matches.evaluateAll(elements => elements.map(el => ({
      x: Number(el.getAttribute("x")), width: Number(el.getAttribute("width")),
      height: Number(el.getAttribute("height")),
    })));
    expect(boxes[0].x).toBeGreaterThan(object.x);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.width).toBeLessThan(object.width / 3);
      expect(box.height).toBeLessThan(object.height / 2);
    }
    if (kind === "text") {
      const expected = await page.locator(".viewer-scroll .editable-text tspan").first().evaluate(el => {
        const span = el as SVGTSpanElement;
        const start = span.textContent!.indexOf("needle");
        const first = span.getExtentOfChar(start), last = span.getExtentOfChar(start + 5);
        return { x: first.x, width: last.x + last.width - first.x };
      });
      expect(Math.abs(boxes[0].x - expected.x)).toBeLessThan(0.1);
      expect(Math.abs(boxes[0].width - expected.width)).toBeLessThan(0.1);
    }
    await search.press("Enter");
    await search.press("Enter");
    await expect(matches.nth(1)).toHaveClass(/current-search-match/);
    await page.getByLabel("ズーム", { exact: true }).selectOption("1.5");
    await expect(matches).toHaveCount(2);
    await search.fill("middle");
    await expect(matches).toHaveCount(1);
    await page.getByRole("button", { name: "検索をクリア", exact: true }).click();
    await expect(matches).toHaveCount(0);
    await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyCount);
    expect(errors).toEqual([]);
  });
}

test("search options apply to source and added text, and highlights refresh through undo", async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([420, 595]).drawText("Cat cat scatter", { x: 40, y: 510, size: 18 });
  await open(page, pdf);
  const search = page.getByLabel("PDF内を検索");
  await search.fill("cat");
  await expect(page.locator(".search-count")).toContainText("1 / 3 件");
  await page.getByLabel("大文字と小文字を区別").check();
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  await page.getByLabel("単語全体に一致").check();
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  await page.getByLabel("大文字と小文字を区別").uncheck();
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const bounds = (await page.locator(".viewer-scroll .page-view").first().boundingBox())!;
  await page.mouse.click(bounds.x + 80, bounds.y + 250);
  await page.getByLabel("テキスト内容").fill("Ｃａｔ");
  await expect(page.locator(".search-count")).toContainText("1 / 3 件");
  await page.locator(".search-results button").last().click();
  await expect(page.locator(".search-object-highlights .current-search-match")).toHaveCount(1);
  await page.getByLabel("全角と半角を同一視").uncheck();
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  await page.getByLabel("全角と半角を同一視").check();
  await page.getByRole("button", { name: "選択", exact: true }).click();
  await page.locator(".viewer-scroll .object-layer g[data-object-id]").filter({ hasText: "Ｃａｔ" }).click();
  await page.getByLabel("テキスト内容").fill("Changed");
  await expect(page.locator(".search-count")).toContainText("1 / 2 件");
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click();
  await expect(page.locator(".search-count")).toContainText("1 / 3 件");
  await search.press("Escape");
  await expect(page.locator(".viewer-scroll .search-match")).toHaveCount(0);
});

test("matches split PDF chunks and keeps highlighting aligned after crop, rotation and zoom", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const secondFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sheet = pdf.addPage([420, 595]);
  sheet.setCropBox(20, 30, 350, 535);
  sheet.setRotation(degrees(90));
  sheet.drawText("split", { x: 50, y: 400, size: 18, font });
  sheet.drawText("word", { x: 50 + font.widthOfTextAtSize("split", 18), y: 400, size: 18, font: secondFont });
  await open(page, pdf);
  const search = page.getByLabel("PDF内を検索");
  await search.fill("splitword");
  await expect(page.locator(".search-count")).toContainText("1 / 1 件");
  await expect(page.locator(".viewer-scroll .textLayer .search-match")).toHaveCount(2);
  await search.press("Enter");
  const source = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^split$/ });
  const mark = source.locator("mark");
  await expect(mark).toHaveText("split");
  await page.getByLabel("ズーム", { exact: true }).selectOption("1.5");
  await expect(page.locator(".viewer-scroll .page-view").first()).toHaveAttribute("data-rendered", "true");
  await expect(mark).toBeVisible();
  const a = await source.evaluate((el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, height: rect.height };
  }), b = (await mark.boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(Math.abs(a.height - b.height)).toBeLessThan(1);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
});

test("pages through large result lists while keyboard navigation follows the global result index", async ({ page }) => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) {
    const sheet = pdf.addPage([420, 595]);
    for (let line = 0; line < 7; line++) sheet.drawText("token ".repeat(10), { x: 40, y: 510 - line * 30, size: 12 });
  }
  await open(page, pdf);
  const search = page.getByLabel("PDF内を検索");
  await search.fill("token");
  await expect(page.locator(".search-count")).toContainText("1 / 210 件");
  await expect(page.locator(".search-results button")).toHaveCount(100);
  await page.getByRole("button", { name: "次の100件", exact: true }).click();
  await page.locator(".search-results button").first().click();
  await expect(page.locator(".search-count")).toContainText("101 / 210 件");
  await search.press("Shift+Enter");
  await expect(page.locator(".search-count")).toContainText("100 / 210 件");
  await expect(page.locator(".search-pagination")).toContainText("1 / 3");
  await page.getByRole("button", { name: "次の100件", exact: true }).click();
  await page.getByRole("button", { name: "次の100件", exact: true }).click();
  await expect(page.locator(".search-results button")).toHaveCount(10);
});

test("bounds common-word searches and discards pending results when switching documents", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 70; i++) {
    const sheet = pdf.addPage([420, 595]);
    for (let line = 0; line < 8; line++) sheet.drawText("token ".repeat(10), { x: 40, y: 510 - line * 30, size: 12 });
  }
  await open(page, pdf);
  const search = page.getByLabel("PDF内を検索");
  await search.fill("token");
  await expect(page.locator(".search-count")).toContainText("1 / 5000 件");
  await expect(page.locator(".search-panel")).toContainText("先頭5000件");
  await expect(page.locator(".search-results button")).toHaveCount(100);
  await search.fill("token absent");
  await search.fill("absent");
  const replacement = await PDFDocument.create();
  replacement.addPage([420, 595]).drawText("New document without matches", { x: 40, y: 510, size: 18 });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "開く", exact: true }).click();
  await (await chooser).setFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: Buffer.from(await replacement.save()) });
  await expect(page.locator(".document-tab")).toContainText("replacement.pdf");
  await page.keyboard.press("Control+f");
  await expect(search).toHaveValue("");
  await search.fill("token");
  await expect(page.locator(".search-count")).toContainText("0 / 0 件");
  await expect(page.locator(".viewer-scroll .search-match")).toHaveCount(0);
  expect(errors).toEqual([]);
});
