import { test, expect } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFString,
  PDFName,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
test("creates a link region, edits an imported link, and persists both destinations", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source = await PDFDocument.create(),
    first = source.addPage([600, 800]);
  source.addPage([600, 800]);
  first.node.addAnnot(
    source.context.register(
      source.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [20, 650, 100, 700],
        A: { S: "URI", URI: PDFHexString.fromText("https://before.example") },
      }),
    ),
  );
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "links.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  const box = await page
    .locator(".viewer-scroll .page-view")
    .first()
    .boundingBox();
  if (!box) throw Error("no page");
  await page.mouse.move(box.x + 60, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 280);
  await page.mouse.up();
  await page
    .getByLabel("リンク先ページ", { exact: true })
    .selectOption({ label: "2 ページ" });
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "リンク管理", exact: true }).click();
  await expect(page.getByLabel("文書内のリンク").locator("option")).toHaveCount(
    3,
  );
  await page.getByLabel("文書内のリンク").selectOption({ index: 1 });
  await page
    .getByLabel("リンクURL", { exact: true })
    .fill("https://after.example/path");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("links-edited.pdf");
  await (await download).saveAs(dest);
  const output = await PDFDocument.load(await readFile(dest)),
    annotations = output.getPage(0).node.Annots()!;
  expect(
    annotations
      .lookup(0, PDFDict)
      .lookup(PDFName.of("A"), PDFDict)
      .lookup(PDFName.of("URI"), PDFString)
      .decodeText(),
  ).toBe("https://after.example/path");
  expect(
    annotations.lookup(1, PDFDict).lookup(PDFName.of("Dest"), PDFArray).get(0),
  ).toEqual(output.getPage(1).ref);
  await page.reload();
  const reopened = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopened).setFiles(dest);
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "リンク管理", exact: true }).click();
  await expect(page.getByLabel("文書内のリンク").locator("option")).toHaveCount(
    3,
  );
  await page.getByLabel("文書内のリンク").selectOption({ index: 1 });
  await expect(page.getByLabel("リンクURL", { exact: true })).toHaveValue(
    "https://after.example/path",
  );
  await page.screenshot({ path: info.outputPath("links-manager.png") });
  expect(errors).toEqual([]);
});
