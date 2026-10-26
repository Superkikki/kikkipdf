import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { emptyDocument, blankPage, newObject } from "../../src/state/model";
import { saveProject, openProject } from "../../src/state/project";
async function fixture(count = 6) {
  const pdf = await PDFDocument.create(); const pages = Array.from({ length: count }, (_, i) => pdf.addPage([300+i,400]));
  const d = emptyDocument(); d.sources.s = { id: "s", name: "original.pdf", bytes: await pdf.save() };
  d.pages = pages.map((_, i) => ({ ...blankPage(), sourceId: "s", sourceIndex: i, width: 300+i, height: 400, label: `P${i+1}` }));
  d.bookmarks = [{ id: "target", title: "Target", pageId: d.pages[count-1].id, children: [] }];
  d.pages[0].objects = [{ ...newObject("link",20,20), link: { kind: "page", pageId: d.pages[count-1].id } }];
  return Buffer.from(await saveProject(d));
}
test("previews manual and duplex orders, rejects bad permutations, undoes and saves PDF/project identities", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.keyboard.press("Escape"); let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles({ name: "order.kpdf", mimeType: "application/zip", buffer: await fixture() });
  await page.getByRole("button", { name: "ページ管理", exact: true }).click(); await page.getByRole("button", { name: "ページ順序", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ページ順序を編集", exact: true }), mode = dialog.getByLabel("ページの並べ方", { exact: true }), input = dialog.getByLabel("変更後のページ順序", { exact: true }), apply = dialog.getByRole("button", { name: "この順序を適用", exact: true });
  await expect(mode).toBeFocused(); const dirtyBefore = await page.locator(".unsaved-dot").count(); await mode.selectOption("interleave");
  const rows = dialog.locator("tbody tr"); await expect(rows.nth(1)).toHaveText("26P6");
  await dialog.getByLabel("後半を逆順にする", { exact: true }).uncheck(); await expect(rows.nth(1)).toHaveText("24P4");
  await dialog.getByLabel("前半のページ数", { exact: true }).fill("2"); await expect(rows.nth(1)).toHaveText("23P3");
  await dialog.getByLabel("前半のページ数", { exact: true }).fill("6"); await expect(dialog.getByRole("alert")).toContainText("前半"); await expect(apply).toBeDisabled();
  await dialog.getByLabel("前半のページ数", { exact: true }).fill("3"); await dialog.getByLabel("後半を逆順にする", { exact: true }).check();
  await dialog.getByRole("button", { name: "この順序を手動で調整", exact: true }).click(); await expect(input).toHaveValue("1,6,2,5,3,4");
  await input.fill("1-6,6"); await expect(dialog.getByRole("alert")).toContainText("重複"); await expect(apply).toBeDisabled();
  await input.fill("1-5"); await expect(dialog.getByRole("alert")).toContainText("未指定");
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click(); await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBefore);
  await page.getByRole("button", { name: "ページ順序", exact: true }).click(); await mode.selectOption("reverse"); await apply.click();
  const labels = page.locator(".thumbnail-page-label"); await expect(labels).toHaveText(["P6","P5","P4","P3","P2","P1"]);
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click(); await expect(labels).toHaveText(["P1","P2","P3","P4","P5","P6"]);
  await page.getByTitle("やり直す (Ctrl+Y)", { exact: true }).click(); await expect(labels).toHaveText(["P6","P5","P4","P3","P2","P1"]);
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click();
  await page.locator("summary").filter({ hasText: /^ページ$/ }).click(); await page.getByRole("button", { name: "ページ順序を編集", exact: true }).click();
  await mode.selectOption("interleave"); await page.screenshot({ path: info.outputPath("page-order-preview.png") }); await apply.click();
  await expect(labels).toHaveText(["P1","P6","P2","P5","P3","P4"]);
  let download = page.waitForEvent("download"); await page.locator("summary").filter({ hasText: "ファイル" }).click(); await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("ordered.kpdf"); await (await download).saveAs(project); const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(restored.pages.map(p => p.label)).toEqual(["P1","P6","P2","P5","P3","P4"]); expect(restored.bookmarks![0].pageId).toBe(restored.pages[1].id);
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click(); const output = info.outputPath("ordered.pdf"); await (await download).saveAs(output);
  expect((await PDFDocument.load(await readFile(output))).getPages().map(p => p.getWidth())).toEqual([300,305,301,304,302,303]);
  await page.reload(); chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles(output);
  await expect(labels).toHaveText(["P1","P6","P2","P5","P3","P4"]); expect(errors).toEqual([]);
});

test("bounds large previews and fits controls inside a short window", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 }); await page.goto("/"); await page.keyboard.press("Escape");
  const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles({ name: "many.kpdf", mimeType: "application/zip", buffer: await fixture(30) });
  await page.locator("summary").filter({ hasText: /^ページ$/ }).click(); await page.getByRole("button", { name: "ページ順序を編集", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ページ順序を編集", exact: true }); await expect(dialog.locator("tbody tr")).toHaveCount(12);
  await dialog.getByLabel("ページの並べ方", { exact: true }).selectOption("oddEven"); await expect(dialog.locator("tbody tr").nth(1)).toHaveText("23P3");
  await expect(dialog.getByRole("button", { name: "この順序を適用", exact: true })).toBeInViewport();
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
