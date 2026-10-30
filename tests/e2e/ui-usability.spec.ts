import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";

async function openFixture(page: Page, count = 3) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    pdf.addPage([420, 595]).drawText(`Review page ${i + 1}`, {
      x: 40,
      y: 520,
      size: 18,
    });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({
    name: "ui-review.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator(".document-tab")).toContainText("ui-review.pdf");
  await expect(page.locator(".viewer-scroll .page-view[data-rendered=true]").first()).toBeVisible();
}

test("toolbar collapses without changing tools, remembers its state, and opens from a category", async ({ page }, info) => {
  await page.goto("/");
  await openFixture(page, 1);
  await expect(page.locator("#document-properties")).toBeHidden();
  const toolbar = page.locator("#document-toolbar");
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const before = (await page.locator(".viewer-scroll").boundingBox())!;
  const collapse = page.getByRole("button", { name: "ツールバーを折りたたむ", exact: true });
  await collapse.focus();
  await page.keyboard.press("Enter");
  const expand = page.getByRole("button", { name: "ツールバーを展開", exact: true });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(toolbar).toBeHidden();
  await expect(page.locator(".collapsed-tool")).toHaveText("使用中: テキスト");
  expect((await page.locator(".viewer-scroll").boundingBox())!.height).toBeGreaterThanOrEqual(before.height + 80);
  await page.screenshot({ path: info.outputPath("toolbar-collapsed.png") });
  await expand.press("Space");
  await expect(toolbar.getByRole("button", { name: "テキスト", exact: true })).toHaveAttribute("aria-pressed", "true");
  await collapse.click();
  await page.getByRole("button", { name: "注釈", exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "付箋", exact: true })).toBeVisible();
  await collapse.click();
  await page.reload();
  await openFixture(page, 1);
  await expect(toolbar).toBeHidden();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(toolbar).toBeVisible();
});

test("toolbar controls fit a compact window in both themes", async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await openFixture(page, 1);
  for (const category of ["編集", "ページ管理", "注釈", "ツール"]) {
    await page.getByRole("button", { name: category, exact: true }).click();
    const tools = page.locator(".toolbar-tools");
    const last = tools.getByRole("button").last();
    await last.scrollIntoViewIfNeeded();
    const bounds = (await last.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
    expect(await page.locator(".app").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(800);
  }
  await page.getByRole("button", { name: "ツールバーを折りたたむ", exact: true }).click();
  await page.getByRole("button", { name: "テーマ切替" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: info.outputPath("toolbar-compact-dark.png") });
  const expand = page.getByRole("button", { name: "ツールバーを展開", exact: true });
  expect((await expand.boundingBox())!.x + (await expand.boundingBox())!.width).toBeLessThanOrEqual(800);
  await expand.click();
  await expect(page.locator("#document-toolbar")).toBeVisible();
});

test("document name edits inline, cancels, validates, undoes, and saves under the new name", async ({ page }, info) => {
  await page.goto("/");
  await openFixture(page);
  const name = page.getByRole("button", { name: "文書の名前を変更", exact: true });
  const input = page.getByRole("textbox", { name: "文書のファイル名", exact: true });
  await name.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("ui-review");
  await page.screenshot({ path: info.outputPath("inline-document-name.png") });
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(9);
  await input.fill("cancelled");
  await input.press("Escape");
  await expect(name).toBeFocused();
  await expect(name).toContainText("ui-review.pdf");
  await page.keyboard.press("F2");
  await input.fill("invalid/name");
  await input.press("Enter");
  await expect(page.locator(".document-name-hint")).toHaveAttribute("role", "alert");
  await expect(input).toBeFocused();
  await input.fill("会議資料.pdf");
  await input.press("Enter");
  await expect(name).toContainText("会議資料.pdf");
  await expect(page.locator(".document-save-state")).toHaveText("未保存の変更");
  await page.keyboard.press("Control+z");
  await expect(name).toContainText("ui-review.pdf");
  await page.keyboard.press("Control+y");
  await expect(name).toContainText("会議資料.pdf");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  expect((await download).suggestedFilename()).toBe("会議資料.pdf");
  await expect(page.locator(".document-save-state")).toHaveText("保存済み");
  await page.locator(".menu").first().locator("summary").click();
  await page.getByRole("button", { name: "名前を変更 F2", exact: true }).click();
  await expect(input).toBeFocused();
  await input.fill("別の資料");
  await page.getByRole("button", { name: "名前を確定", exact: true }).click();
  await expect(name).toContainText("別の資料.pdf");
});

test("saving commits the name draft and invalid names stop both button and keyboard saves", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, 1);
  const input = page.getByRole("textbox", { name: "文書のファイル名", exact: true });
  await page.getByRole("button", { name: "文書の名前を変更", exact: true }).click();
  await input.fill("ボタンで保存");
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("ボタンで保存.pdf");
  await expect(input).toHaveCount(0);
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await page.keyboard.press("F2");
  await input.fill("キーで保存");
  download = page.waitForEvent("download");
  await input.press("Control+s");
  expect((await download).suggestedFilename()).toBe("キーで保存.pdf");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await page.keyboard.press("F2");
  await input.fill("invalid/name");
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  await input.press("Control+s");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(input).toBeFocused();
  expect(downloads).toEqual([]);
  await expect(page.locator(".document-tab")).not.toContainText("invalid/name.pdf");
  await input.fill("保存しない変換途中");
  await input.dispatchEvent("compositionstart");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(input).toBeVisible();
  expect(downloads).toEqual([]);
  await input.dispatchEvent("compositionend");
  download = page.waitForEvent("download");
  await input.press("Control+Shift+s");
  expect((await download).suggestedFilename()).toBe("保存しない変換途中.pdf");
});

test("thumbnail menus operate on the chosen page and deleting a page focuses its range", async ({ page }, info) => {
  await page.goto("/");
  await openFixture(page);
  const thumbnails = page.locator(".thumbnail");
  const menu = page.getByRole("menu", { name: "ページの操作", exact: true });
  await thumbnails.nth(1).click({ button: "right" });
  await menu.getByRole("menuitem", { name: "90° 回転", exact: true }).click();
  await expect(thumbnails.nth(1)).toHaveAttribute("aria-current", "page");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const file = await download;
  const saved = info.outputPath("rotated.pdf");
  await file.saveAs(saved);
  const pdf = await PDFDocument.load(await readFile(saved));
  expect(pdf.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
  await page.getByRole("button", { name: "ページ 2 の操作", exact: true }).click();
  await menu.getByRole("menuitem", { name: "複製", exact: true }).click();
  await expect(thumbnails).toHaveCount(4);
  await page.keyboard.press("Control+z");
  await expect(thumbnails).toHaveCount(3);
  await thumbnails.nth(1).focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "削除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ページを削除" });
  const range = dialog.getByRole("textbox", { name: "削除するページ範囲" });
  await expect(range).toBeFocused();
  await expect(range).toHaveValue("2");
  expect(await range.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(1);
  await range.press("Enter");
  await expect(thumbnails).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(thumbnails).toHaveCount(3);
  await page.getByRole("button", { name: "ページ 1 の操作", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ページ 1 の操作", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "ページ 3 の操作", exact: true }).click();
  await page.locator(".document-tab").click({ position: { x: 4, y: 4 } });
  await expect(menu).toHaveCount(0);
});

test("page menus fit short windows, skip disabled deletion, and sidebar tabs have visible labels", async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await openFixture(page, 1);
  for (const name of ["ページ", "しおり", "コメント", "検索", "添付ファイル", "OCR校正", "レイヤー"]) {
    const button = page.locator(".side-tabs").getByRole("button", { name, exact: true });
    await expect(button.locator("span")).toBeVisible();
    const bounds = (await button.boundingBox())!;
    const label = (await button.locator("span").boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(bounds.x);
    expect(label.x + label.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  await page.getByRole("button", { name: "ページ 1 の操作", exact: true }).click();
  const menu = page.getByRole("menu", { name: "ページの操作", exact: true });
  await expect(menu.getByRole("menuitem", { name: "削除", exact: true })).toBeDisabled();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "複製", exact: true })).toBeFocused();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(592);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(792);
  await page.screenshot({ path: info.outputPath("page-menu-compact.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("ページ範囲（空欄は全ページ）", { exact: true })).toBeFocused();
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル", exact: true }).click();
});

test("narrow workspace expands the document and reveals properties when editing", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await openFixture(page);
  const properties = page.locator("#document-properties");
  const sidebar = page.locator("#document-sidebar");
  await expect(properties).toBeHidden();
  const withSidebar = (await page.locator(".viewer-scroll").boundingBox())!.width;
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByLabel("PDF内を検索").fill("Review");
  await expect(page.locator(".search-results button")).toHaveCount(3);
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await expect(sidebar).toBeHidden();
  expect((await page.locator(".viewer-scroll").boundingBox())!.width).toBeGreaterThan(withSidebar + 150);
  await page.getByRole("button", { name: "サイドバー", exact: true }).click();
  await expect(page.getByLabel("PDF内を検索")).toHaveValue("Review");
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  await expect(page.locator(".toolbar-hint")).toContainText("クリックして文字を追加");
  const box = (await page.locator(".viewer-scroll .page-view").first().boundingBox())!;
  await page.mouse.click(box.x + 60, box.y + 150);
  await expect(properties).toBeVisible();
  await expect(page.getByRole("button", { name: "プロパティパネル", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("テキスト内容").fill("UI review annotation");
  await page.getByRole("button", { name: "プロパティを閉じる", exact: true }).click();
  await expect(properties).toBeHidden();
  await page.getByRole("button", { name: "プロパティパネル", exact: true }).click();
  await expect(page.getByLabel("テキスト内容")).toHaveValue("UI review annotation");
  await page.getByRole("button", { name: "テーマ切替" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("テキスト内容")).toHaveValue("UI review annotation");
});

test("menus dismiss outside and on Escape, remain exclusive, and fit short windows", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  const file = page.locator(".menu").first();
  const pages = page.locator(".menu").nth(1);
  await file.locator("summary").click();
  await expect(file.getByRole("button", { name: "保存 Ctrl+S", exact: true })).toBeDisabled();
  const bounds = (await file.locator("div").boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThan(600);
  await page.locator(".welcome").click({ position: { x: 12, y: 12 } });
  await expect(file).not.toHaveAttribute("open");
  await file.locator("summary").click();
  await pages.locator("summary").click();
  await expect(pages).toHaveAttribute("open");
  await expect(file).not.toHaveAttribute("open");
  await page.keyboard.press("Escape");
  await expect(pages).not.toHaveAttribute("open");
  await expect(pages.locator("summary")).toBeFocused();
  // Closing a menu must not also cancel the active drawing tool.
  await openFixture(page);
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  await file.locator("summary").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "テキスト", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("page number can be cleared, typed digit by digit, and corrected on commit", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, 12);
  const input = page.getByLabel("ページ番号", { exact: true });
  await input.fill("");
  await expect(input).toHaveValue("");
  await input.pressSequentially("12");
  await expect(input).toHaveValue("12");
  await expect(page.locator(".thumbnail").nth(11)).toHaveAttribute("aria-current", "page");
  await input.fill("999");
  await input.press("Enter");
  await expect(input).toHaveValue("12");
  await input.fill("");
  await input.press("Tab");
  await expect(input).toHaveValue("12");
  await input.fill("0");
  await input.press("Enter");
  await expect(input).toHaveValue("1");
  await input.fill("abc");
  await input.press("Escape");
  await expect(input).toHaveValue("1");
  await page.locator(".thumbnail").nth(2).focus();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("3");
});
