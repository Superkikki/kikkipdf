import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { inspectDirectText } from "../../src/direct/content";
import { inspectFont } from "../../src/fonts/inspect";
import { blankPage, emptyDocument, newObject } from "../../src/state/model";
import { saveProject } from "../../src/state/project";

async function openFixture(page: Page, count = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const sheet = pdf.addPage([420, 595]);
    sheet.drawText("Click to edit", { x: 40, y: 510, size: 18 });
    sheet.drawText("Keep this line", { x: 40, y: 460, size: 18 });
  }
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "inline.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
}

const source = (page: Page) => page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Click to edit$/ });
const editor = (page: Page) => page.getByRole("textbox", { name: "ページ上のテキスト編集", exact: true });
const overlay = (page: Page) => page.locator(".viewer-scroll .editable-text[data-layout-ready=true]");

async function openCustomFixture(page: Page, count = 1) {
  const font = await inspectFont(new Uint8Array(await readFile(
    "public/assets/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  )), "LiberationSans-Regular.ttf");
  const model = emptyDocument();
  model.pages = Array.from({ length: count }, () => blankPage());
  model.fonts = { [font.id]: font };
  model.pages[0].objects = [{
    ...newObject("text", 40, 80), text: "Keep original", font: "custom", fontId: font.id,
  }];
  if (count > 1) model.pages[0].objects.push({
    ...newObject("text", 40, 180), text: "Other object", font: "custom", fontId: font.id,
  });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({
    name: "inline-font-error.kpdf", mimeType: "application/zip", buffer: Buffer.from(await saveProject(model)),
  });
  await expect(overlay(page).filter({ hasText: /^Keep original$/ })).toBeVisible();
}

test("one click edits original PDF text, supports Japanese input and saves only the replacement", async ({ page }, info) => {
  await openFixture(page);
  const neighbour = page.locator(".viewer-scroll .textLayer span").filter({ hasText: /^Keep this line$/ });
  const before = await neighbour.boundingBox();
  await source(page).click();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue("Click to edit");
  await editor(page).fill("クリックで日本語に編集");
  await expect(page.locator(".inline-font-hint")).toBeVisible();
  await expect(editor(page)).toHaveAttribute("data-layout-ready", "true");
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]")).toBeVisible();
  await page.screenshot({ path: info.outputPath("inline-editor.png") });
  await editor(page).press("Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveText("クリックで日本語に編集");
  await expect(page.getByLabel("フォント", { exact: true })).toHaveValue("japanese");
  const after = await neighbour.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1);
  expect(after!.y).toBeCloseTo(before!.y, 1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const path = info.outputPath("inline-saved.pdf");
  await (await download).saveAs(path);
  const runs = (await inspectDirectText(new Uint8Array(await readFile(path)), 0)).runs.map(run => run.text);
  expect(runs).toContain("クリックで日本語に編集");
  expect(runs).toContain("Keep this line");
  expect(runs).not.toContain("Click to edit");
});

test("Escape cancels a new source edit and leaves the original document unchanged", async ({ page }) => {
  await openFixture(page);
  await source(page).click();
  await editor(page).fill("Discard this");
  await editor(page).press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(source(page)).toBeVisible();
  await expect(page.locator(".viewer-scroll .object-layer > g")).toHaveCount(0);
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
});

test("new text is focused, accepts line breaks, and can be reedited, cancelled and undone", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const bounds = (await page.locator(".viewer-scroll .page-view").boundingBox())!;
  await page.mouse.click(bounds.x + 70, bounds.y + 250);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("First line");
  await editor(page).press("Shift+Enter");
  await editor(page).pressSequentially("Second line");
  await expect(editor(page)).toHaveValue("First line\nSecond line");
  await page.getByRole("button", { name: "文字編集を確定", exact: true }).click();
  await expect(overlay(page).locator("tspan")).toHaveCount(2);
  await expect(page.getByLabel("テキスト内容")).toHaveValue("First line\nSecond line");
  await page.getByRole("button", { name: "文字を編集: First line Second line" }).click();
  await editor(page).fill("Cancelled");
  await page.getByRole("button", { name: "文字編集を取り消す", exact: true }).click();
  await expect(page.getByLabel("テキスト内容")).toHaveValue("First line\nSecond line");
  await page.getByRole("button", { name: "文字を編集: First line Second line" }).click();
  await editor(page).fill("Final text");
  await editor(page).press("Enter");
  await expect(overlay(page)).toHaveText("Final text");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("テキスト内容")).toHaveValue("First line\nSecond line");
  await page.keyboard.press("Control+y");
  await expect(page.getByLabel("テキスト内容")).toHaveValue("Final text");
});

test("IME confirmation does not submit or cancel the editor", async ({ page }) => {
  await openFixture(page);
  await source(page).click();
  await editor(page).dispatchEvent("compositionstart");
  await editor(page).fill("日本語入力中");
  await editor(page).press("Enter");
  await expect(editor(page)).toBeFocused();
  await editor(page).press("Escape");
  await expect(editor(page)).toBeVisible();
  await editor(page).dispatchEvent("compositionend", { data: "日本語入力中" });
  await editor(page).press("Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveText("日本語入力中");
});

test("clicking outside commits and keyboard save includes unsubmitted input", async ({ page }, info) => {
  await openFixture(page);
  await source(page).click();
  await editor(page).fill("Outside commit");
  await page.locator(".page-caption").click();
  await expect(editor(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveText("Outside commit");
  await page.getByRole("button", { name: "文字を編集: Outside commit" }).click();
  await editor(page).fill("Saved from editor");
  const download = page.waitForEvent("download");
  await editor(page).press("Control+s");
  const path = info.outputPath("inline-shortcut.pdf");
  await (await download).saveAs(path);
  const runs = (await inspectDirectText(new Uint8Array(await readFile(path)), 0)).runs.map(run => run.text);
  expect(runs).toContain("Saved from editor");
  expect(runs).not.toContain("Outside commit");
});

test("dragging selects source text for copying and moves added text without opening the editor", async ({ page }) => {
  await openFixture(page);
  const original = (await source(page).boundingBox())!;
  await page.mouse.move(original.x + 2, original.y + original.height / 2);
  await page.mouse.down();
  await page.mouse.move(original.x + original.width - 2, original.y + original.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(editor(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("Click to edi");
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const bounds = (await page.locator(".viewer-scroll .page-view").boundingBox())!;
  await page.mouse.click(bounds.x + 70, bounds.y + 250);
  await editor(page).fill("Move me");
  await editor(page).press("Enter");
  const object = page.getByRole("button", { name: "文字を編集: Move me" });
  const start = (await object.boundingBox())!;
  const x = Number(await page.getByLabel("x", { exact: true }).inputValue());
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(editor(page)).toHaveCount(0);
  expect(Number(await page.getByLabel("x", { exact: true }).inputValue())).toBeGreaterThan(x);
});

test("clicks place the caret within original and added text, including a rotated page", async ({ page }) => {
  await openFixture(page);
  const boundary = await source(page).evaluate(el => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 5);
    const rect = range.getBoundingClientRect();
    return { x: rect.right, y: (rect.top + rect.bottom) / 2 };
  });
  await page.mouse.click(boundary.x, boundary.y);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("!");
  await expect(editor(page)).toHaveValue("Click! to edit");
  await editor(page).press("Enter");
  await expect(overlay(page)).toBeVisible();
  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "回転", exact: true }).click();
  const rotated = await overlay(page).locator("tspan").evaluate(el => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 6);
    const rect = range.getBoundingClientRect();
    return { x: (rect.left + rect.right) / 2, y: rect.bottom };
  });
  await page.mouse.click(rotated.x, rotated.y);
  await expect(editor(page)).toBeFocused();
  await editor(page).pressSequentially("?");
  await expect(editor(page)).toHaveValue("Click!? to edit");
});

test("scrolling to another page retains unfinished text instead of discarding it", async ({ page }) => {
  await openFixture(page, 3);
  await source(page).first().click();
  await editor(page).fill("Committed by scrolling");
  await page.locator(".viewer-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(editor(page)).toHaveCount(0);
  await page.locator(".thumbnail").first().click();
  await expect(overlay(page)).toHaveText("Committed by scrolling");
});

test("font errors block shortcut and toolbar saves without losing the inline draft", async ({ page }, info) => {
  await openCustomFixture(page);
  await expect(overlay(page)).toHaveText("Keep original");
  const dirtyBeforeSave = await page.locator(".unsaved-dot").count();
  await page.getByRole("button", { name: "文字を編集: Keep original", exact: true }).click();
  await editor(page).fill("日本語の未対応文字");
  await editor(page).press("Enter");
  await expect(page.getByRole("alert")).toContainText("登録フォントに含まれない文字");
  await expect(editor(page)).toHaveValue("日本語の未対応文字");
  await expect(overlay(page)).toHaveText("Keep original");
  await expect(page.getByRole("button", { name: "文字編集を確定", exact: true })).toBeDisabled();
  for (const save of [
    () => editor(page).press("Control+s"),
    () => page.getByRole("button", { name: "保存", exact: true }).click(),
  ]) {
    const blockedDownload = page.waitForEvent("download", { timeout: 750 }).catch(() => null);
    await save();
    expect(await blockedDownload).toBeNull();
    await expect(editor(page)).toHaveValue("日本語の未対応文字");
    await expect(overlay(page)).toHaveText("Keep original");
    await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBeforeSave);
  }
  await editor(page).fill("Valid replacement");
  await expect(editor(page)).toHaveAttribute("data-layout-ready", "true");
  const download = page.waitForEvent("download");
  await editor(page).press("Control+s");
  const saved = info.outputPath("inline-font-corrected.pdf");
  await (await download).saveAs(saved);
  const runs = (await inspectDirectText(new Uint8Array(await readFile(saved)), 0)).runs.map(run => run.text);
  expect(runs).toContain("Valid replacement");
  expect(runs).not.toContain("Keep original");
});

test("IME composition blocks saves until composition ends and preserves the composed text", async ({ page }, info) => {
  await openFixture(page);
  await source(page).click();
  await editor(page).dispatchEvent("compositionstart");
  await editor(page).fill("日本語入力中");
  const dirtyBeforeSave = await page.locator(".unsaved-dot").count();
  for (const save of [
    () => editor(page).press("Control+s"),
    () => page.getByRole("button", { name: "保存", exact: true }).click(),
  ]) {
    const blockedDownload = page.waitForEvent("download", { timeout: 750 }).catch(() => null);
    await save();
    expect(await blockedDownload).toBeNull();
    await expect(editor(page)).toHaveValue("日本語入力中");
    await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBeforeSave);
  }
  await editor(page).dispatchEvent("compositionend", { data: "日本語入力中" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("inline-composed.pdf");
  await (await download).saveAs(saved);
  const runs = (await inspectDirectText(new Uint8Array(await readFile(saved)), 0)).runs.map(run => run.text);
  expect(runs).toContain("日本語入力中");
  expect(runs).not.toContain("Click to edit");
});

test("font errors and IME retain drafts through page navigation, object clicks and scrolling beyond rendered pages", async ({ page }, info) => {
  await openCustomFixture(page, 4);
  const viewer = page.locator(".viewer-scroll");
  const number = page.getByLabel("ページ番号", { exact: true });
  const other = page.getByRole("button", { name: "文字を編集: Other object", exact: true });
  const dirtyBefore = await page.locator(".unsaved-dot").count();
  await page.getByRole("button", { name: "文字を編集: Keep original", exact: true }).click();
  await editor(page).fill("未対応の文字を保持");
  await expect(page.getByRole("alert")).toContainText("登録フォントに含まれない文字");
  async function retainedAfterNavigation(value: string) {
    await page.locator(".thumbnail").nth(1).click();
    await expect(number).toHaveValue("1");
    await expect(editor(page)).toHaveValue(value);
    await other.click();
    await expect(editor(page)).toHaveValue(value);
    await viewer.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.locator(".viewer-scroll .page-section").first().evaluate(el =>
      el.getBoundingClientRect().bottom - el.closest(".viewer-scroll")!.getBoundingClientRect().top,
    )).toBeLessThan(-600);
    await expect(editor(page)).toHaveCount(1);
    await expect(editor(page)).toHaveValue(value);
    await expect(number).toHaveValue("1");
    await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBefore);
    await viewer.evaluate(el => { el.scrollTop = 0; });
    await expect(editor(page)).toBeInViewport();
  }
  await retainedAfterNavigation("未対応の文字を保持");
  await editor(page).fill("Valid draft");
  await expect(editor(page)).toHaveAttribute("data-layout-ready", "true");
  await editor(page).press("Enter");
  await expect(editor(page)).toHaveCount(0);
  await page.getByRole("button", { name: "文字を編集: Valid draft", exact: true }).click();
  await editor(page).dispatchEvent("compositionstart");
  await editor(page).fill("Composed retained text");
  await retainedAfterNavigation("Composed retained text");
  await editor(page).dispatchEvent("compositionend", { data: "Composed retained text" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = info.outputPath("inline-retained.pdf");
  await (await download).saveAs(saved);
  const runs = (await inspectDirectText(new Uint8Array(await readFile(saved)), 0)).runs.map(run => run.text);
  expect(runs).toContain("Composed retained text");
  expect(runs).toContain("Other object");
  expect(runs).not.toContain("Keep original");
});
