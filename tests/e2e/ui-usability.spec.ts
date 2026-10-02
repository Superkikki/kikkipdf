import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

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
