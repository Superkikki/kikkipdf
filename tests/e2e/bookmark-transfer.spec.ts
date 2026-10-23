import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyDocument, blankPage } from "../../src/state/model";
import { exportPdf } from "../../src/export/engine";
import { openProject } from "../../src/state/project";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";

test("exports every bookmark, imports with an offset, rejects bad files, deletes filtered branches and saves", async ({ page }, info) => {
  const d = emptyDocument(); d.pages = [blankPage(), blankPage(), blankPage()];
  d.bookmarks = [{ id: "root", title: "Root 資料", expanded: false, color: "#336699", bold: true, children: [
    { id: "leaf", title: "Needle", pageId: d.pages[1].id, destination: { kind: "XYZ", left: 10, top: 300, zoom: 2 }, children: [] },
    { id: "url", title: "Link", url: "https://example.com/", children: [] },
  ] }];
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.keyboard.press("Escape");
  let chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "transfer.pdf", mimeType: "application/pdf", buffer: Buffer.from(await exportPdf(d)) });
  await page.getByRole("button", { name: "しおり", exact: true }).click();
  const panel = page.locator(".bookmark-panel"), actions = panel.locator(".bookmark-file-actions"), search = panel.getByLabel("しおりを検索", { exact: true });
  await actions.locator("summary").click(); await search.fill("needle");
  let download = page.waitForEvent("download"); await actions.getByRole("button", { name: "しおりJSONを書き出す", exact: true }).click();
  const json = info.outputPath("bookmarks.json"); await (await download).saveAs(json);
  const data = JSON.parse(await readFile(json, "utf8")); expect(data.bookmarks[0].title).toBe("Root 資料"); expect(data.bookmarks[0].children).toHaveLength(2);
  expect(data.bookmarks[0].children[0].page).toBe(2); expect(data.bookmarks[0].id).toBeUndefined();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  chooser = page.waitForEvent("filechooser"); await actions.getByRole("button", { name: "しおりJSONを読み込む", exact: true }).click();
  await (await chooser).setFiles(json);
  await page.getByLabel("ページ番号の補正", { exact: true }).fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "追加", exact: true }).click();
  await expect(actions.getByRole("status")).toContainText("3件のしおりを追加");
  await search.fill(""); await expect(panel.getByRole("button", { name: "Root 資料", exact: true })).toHaveCount(2);
  await panel.getByRole("button", { name: "すべて展開", exact: true }).click();
  await panel.getByRole("button", { name: "Needle", exact: true }).nth(1).click(); await expect(page.getByLabel("ページ番号", { exact: true })).toHaveValue("3");
  await search.fill("ＮＥＥＤＬＥ"); await expect(actions).toContainText("名前の一致: 2件 ／ 子を含む削除対象: 2件");
  await actions.getByRole("button", { name: "絞り込んだしおりを一括削除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Needle", exact: true })).toHaveCount(2);
  await actions.getByRole("button", { name: "絞り込んだしおりを一括削除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Needle", exact: true })).toHaveCount(0);
  await page.getByTitle("元に戻す (Ctrl+Z)", { exact: true }).click(); await expect(panel.getByRole("button", { name: "Needle", exact: true })).toHaveCount(2);
  await page.getByTitle("やり直す (Ctrl+Y)", { exact: true }).click(); await search.fill("Root");
  await expect(actions).toContainText("名前の一致: 2件 ／ 子を含む削除対象: 4件");
  await search.fill("");
  chooser = page.waitForEvent("filechooser"); await actions.getByRole("button", { name: "しおりJSONを読み込む", exact: true }).click();
  await (await chooser).setFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...data, bookmarks: [{ title: "Bad", url: "javascript:alert(1)", children: [] }] })) });
  await expect(actions.getByRole("alert")).toContainText("https");
  chooser = page.waitForEvent("filechooser"); await actions.getByRole("button", { name: "しおりJSONを読み込む", exact: true }).click(); await (await chooser).setFiles(json);
  await page.getByLabel("ページ番号の補正", { exact: true }).fill("9999"); await page.getByRole("dialog").getByRole("button", { name: "追加", exact: true }).click();
  await expect(actions.getByRole("alert")).toContainText("範囲外"); await expect(panel.getByRole("button", { name: "Root 資料", exact: true })).toHaveCount(2);
  download = page.waitForEvent("download"); await page.locator("summary").filter({ hasText: "ファイル" }).click(); await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("transfer.kpdf"); await (await download).saveAs(project); const restored = await openProject(new Uint8Array(await readFile(project)));
  expect(restored.bookmarks).toHaveLength(2); expect(restored.bookmarks![1].children).toHaveLength(1); expect(restored.bookmarks![1].children[0].url).toBe("https://example.com/");
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click(); const output = info.outputPath("transfer.pdf"); await (await download).saveAs(output);
  const saved = await PDFDocument.load(await readFile(output)), first = saved.catalog.lookup(PDFName.of("Outlines"), PDFDict).lookup(PDFName.of("First"), PDFDict);
  expect(first.has(PDFName.of("Next"))).toBe(true); expect(errors).toEqual([]);
});
