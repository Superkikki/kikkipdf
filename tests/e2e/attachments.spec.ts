import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import {
  attachmentEntries,
  extractAttachment,
} from "../../src/attachments/pdfAttachments";
test("edit, add, extract, delete and undo PDF attachments with a saved PDF round trip", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source = await PDFDocument.create();
  source.addPage();
  const original = Buffer.from("元の添付データ");
  await source.attach(original, "元の資料.txt");
  await page.goto("/");
  let chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "with-files.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  await page.getByRole("button", { name: "添付ファイル", exact: true }).click();
  await page
    .locator(".attachment-item")
    .filter({ hasText: "元の資料.txt" })
    .click();
  await page.getByLabel("添付ファイル名", { exact: true }).fill("変更済み.txt");
  await page.getByLabel("添付の説明").fill("説明を更新");
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "添付を取り出す" }).click();
  const raw = info.outputPath("attachment.txt");
  await (await download).saveAs(raw);
  expect(await readFile(raw)).toEqual(original);
  chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添付ファイルを追加" }).click();
  await (
    await chooser
  ).setFiles({
    name: "追加.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("a,b\n1,2"),
  });
  await expect(page.locator(".attachment-item")).toHaveCount(2);
  await page.getByRole("button", { name: "添付を削除" }).click();
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".attachment-item")).toHaveCount(2);
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("attachments.pdf");
  await (await download).saveAs(dest);
  const savedBytes = new Uint8Array(await readFile(dest));
  const output = await PDFDocument.load(savedBytes),
    list = attachmentEntries(output, "saved");
  expect(list.map((a) => a.name).sort()).toEqual(["変更済み.txt", "追加.csv"]);
  expect(list.find((a) => a.name === "変更済み.txt")?.description).toBe(
    "説明を更新",
  );
  expect(
    await extractAttachment(
      {
        sources: {
          saved: { id: "saved", name: "saved.pdf", bytes: savedBytes },
        },
      },
      list.find((a) => a.name === "変更済み.txt")!.id,
    ),
  ).toEqual(new Uint8Array(original));
  expect(errors).toEqual([]);
});
