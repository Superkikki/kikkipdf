import { test, expect } from "@playwright/test";

test.use({ reducedMotion: "no-preference" });

const opening = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "GHOST PROTOCOL 起動演出" });

test("opening completes and releases the PDF workspace", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(opening(page)).toBeVisible();
  await expect(page.locator(".app").locator("..")).toHaveAttribute("inert", "");
  await expect(opening(page)).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByRole("button", { name: "PDFを開く", exact: true })).toBeEnabled();
  await expect(page.locator(".app").locator("..")).not.toHaveAttribute("inert", "");
  expect(errors).toEqual([]);
});

test("Escape and button skip; hidden shortcut replays without losing workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "起動演出をスキップ" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opening(page)).toHaveCount(0);
  const open = page.getByRole("button", { name: "PDFを開く", exact: true });
  await open.focus();
  await page.keyboard.press("Control+Shift+k");
  await expect(opening(page)).toBeVisible();
  const skip = page.getByRole("button", { name: "起動演出をスキップ" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await skip.click();
  await expect(opening(page)).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("reduced motion uses a brief static opening", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".ghost-opening")).toHaveClass(/ghost-reduced/);
  await expect(opening(page)).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByRole("heading", { name: "PDFを、思いどおりに。" })).toBeVisible();
});

test("skip stays accessible on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(opening(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "起動演出をスキップ" })).toBeInViewport();
  await page.getByRole("button", { name: "起動演出をスキップ" }).click();
  await expect(opening(page)).toHaveCount(0);
});

// Startup recovery prompts must remain usable, even before the intro completes.
test("application dialogs take priority over the opening", async ({ page }) => {
  await page.goto("/");
  await expect(opening(page)).toBeVisible();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.textContent = "復元確認";
    document.querySelector(".app")!.append(dialog);
    dialog.showModal();
  });
  await expect(opening(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".app").locator("..")).not.toHaveAttribute("inert", "");
});
