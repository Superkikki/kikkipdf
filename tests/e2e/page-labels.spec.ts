import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("sets, navigates by, clears and undoes logical page labels", async ({ page }) => {
  const source = await PDFDocument.create();
  for (let i = 0; i < 4; i++) source.addPage([300, 400]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "labels.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()) });

  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "ページラベル", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ページラベル" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("ラベルを設定するページ範囲")).toHaveValue("1");
  await dialog.getByLabel("ラベルを設定するページ範囲").fill("1-4");
  await dialog.getByLabel("番号の形式").selectOption("r");
  await dialog.getByLabel("ラベルの接頭辞").fill("章-");
  await dialog.getByLabel("ラベルの開始番号").fill("4");
  await expect(dialog).toContainText("章-iv");
  await dialog.getByRole("button", { name: "ラベルを適用", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".page-caption").first()).toContainText("章-iv");
  await expect(page.locator(".page-caption").first()).toContainText("1 / 4");
  await expect(page.locator(".thumbnail").first()).toContainText("章-iv");
  await page.screenshot({ path: test.info().outputPath("page-labels.png") });

  await page.getByLabel("ページラベルで移動", { exact: true }).fill("章-vi");
  await page.getByLabel("ページラベルで移動", { exact: true }).press("Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await expect(page.locator(".page-caption").nth(2)).toContainText("章-vi");
  await page.getByLabel("ページラベルで移動", { exact: true }).fill("missing");
  await page.getByLabel("ページラベルで移動", { exact: true }).press("Enter");
  await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("ページラベルで移動", { exact: true })).toHaveAttribute("aria-invalid", "true");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = await download;
  const path = test.info().outputPath("page-labels.pdf");
  await saved.saveAs(path);
  await page.reload();
  const reopen = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopen).setFiles(path);
  await expect(page.locator(".page-caption").first()).toContainText("章-iv");

  await page.getByRole("button", { name: "ページ管理", exact: true }).click();
  await page.getByRole("button", { name: "ページラベル", exact: true }).click();
  const clearDialog = page.getByRole("dialog", { name: "ページラベル" });
  await clearDialog.getByLabel("ラベルを設定するページ範囲").fill("");
  await clearDialog.getByRole("button", { name: "ラベルを解除", exact: true }).click();
  await expect(clearDialog).toHaveCount(0);
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(page.locator(".page-caption").first()).toContainText("章-iv");
  expect(errors).toEqual([]);
});
