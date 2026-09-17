import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFDict, PDFHexString } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
async function menu(page: Page, name: string) {
  await page.locator("summary").filter({ hasText: "ファイル" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
test("fills imported multiline and multiselect form controls without losing choices", async ({
  page,
}, info) => {
  const input = await PDFDocument.create(),
    sheet = input.addPage(),
    form = input.getForm();
  const notes = form.createTextField("Notes");
  notes.enableMultiline();
  notes.setMaxLength(30);
  notes.addToPage(sheet);
  const tags = form.createOptionList("Tags");
  tags.enableMultiselect();
  tags.setOptions(["One", "Two", "Three"]);
  tags.select(["One", "Three"]);
  tags.addToPage(sheet);
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "multi.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await input.save()),
  });
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValues([
    "One",
    "Three",
  ]);
  await page
    .getByLabel("Notes", { exact: true })
    .fill("First line\nSecond line");
  await page.getByLabel("Tags", { exact: true }).selectOption(["Two", "Three"]);
  await page.getByRole("button", { name: "完了", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("multi-filled.pdf");
  await (await download).saveAs(dest);
  const saved = await PDFDocument.load(await readFile(dest));
  expect(saved.getForm().getTextField("Notes").getText()).toBe(
    "First line\nSecond line",
  );
  expect(saved.getForm().getOptionList("Tags").getSelected()).toEqual([
    "Two",
    "Three",
  ]);
});
test("create an editable Japanese form and bookmarks, preserve them after PDF save", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await page
    .getByRole("button", { name: "フォームを作成・編集", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "テキスト", exact: true })
    .click();
  await page.getByLabel("フィールド名", { exact: true }).fill("お名前");
  await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("お名前", { exact: true })
    .fill("山田 太郎");
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(
    page.locator(".viewer-scroll").getByLabel("お名前", { exact: true }),
  ).toHaveValue("山田 太郎");
  await page.getByRole("button", { name: "しおり", exact: true }).click();
  await page
    .getByRole("button", { name: "現在のページにしおり", exact: true })
    .click();
  await page.getByLabel("しおりの名前", { exact: true }).fill("申込書");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("editable-form.pdf");
  await (await download).saveAs(dest);
  const pdf = await PDFDocument.load(await readFile(dest));
  expect(pdf.getForm().getTextField("お名前").getText()).toBe("山田 太郎");
  await page.reload();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles(dest);
  await page.getByRole("button", { name: "しおり", exact: true }).click();
  await expect(page.locator(".bookmark-panel")).toContainText("申込書");
  await page.getByRole("button", { name: "ツール", exact: true }).click();
  await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("お名前", { exact: true }),
  ).toHaveValue("山田 太郎");
  expect(errors).toEqual([]);
});
test("edits existing comments and saves semantic markup with object keyboard editing", async ({
  page,
}, info) => {
  const source = await PDFDocument.create(),
    p = source.addPage();
  const note = source.context.register(
    source.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [10, 10, 30, 30],
      Contents: PDFHexString.fromText("Original note"),
      P: p.ref,
      F: 4,
    }),
  );
  p.node.addAnnot(note);
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await page.locator(".comment-card").click();
  await page
    .getByLabel("コメント内容", { exact: true })
    .fill("変更したコメント");
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const box = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!box) throw Error("no page");
  await page.mouse.click(box.x + 80, box.y + 100);
  await page.getByLabel("テキスト内容").fill("コピー元");
  await page.locator(".viewer-scroll .object-layer > g").click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".viewer-scroll .object-layer > g")).toHaveCount(2);
  await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "注釈", exact: true }).click();
  await page.getByRole("button", { name: "蛍光ペン", exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 275);
  await page.mouse.up();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const dest = info.outputPath("comments-markup.pdf");
  await (await download).saveAs(dest);
  const output = await PDFDocument.load(await readFile(dest)),
    annots = output.getPage(0).node.Annots()!;
  expect(
    annots
      .lookup(0, PDFDict)
      .lookup(PDFName.of("Contents"), PDFHexString)
      .decodeText(),
  ).toBe("変更したコメント");
  expect(annots.lookup(1, PDFDict).get(PDFName.of("Subtype"))?.toString()).toBe(
    "/Highlight",
  );
});
test("print preparation outputs only selected PDF sheets with their physical sizes", async ({
  page,
}, info) => {
  // Do not send anything to a physical printer in automated tests.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.addPage([500, 300]);
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "print.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await source.save()),
  });
  await expect(page.locator(".document-tab")).toContainText("print.pdf");
  await page.keyboard.press("Control+p");
  await page.getByLabel("ページ範囲（空欄は全ページ）").fill("1-2");
  await page.getByLabel("印刷解像度").selectOption("72");
  await page
    .getByRole("button", { name: "印刷画面を開く", exact: true })
    .click();
  await expect(page.locator("#kikki-print-root .print-sheet")).toHaveCount(2);
  await expect(page.locator(".status-message")).toContainText(
    "印刷画面を開きました",
  );
  const bytes = await page.pdf({
    path: info.outputPath("printed.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  const printed = await PDFDocument.load(bytes);
  expect(printed.getPageCount()).toBe(2);
  expect(printed.getPage(0).getWidth()).toBeCloseTo(300, 0);
  expect(printed.getPage(1).getWidth()).toBeCloseTo(500, 0);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#kikki-print-root")).toHaveCount(0);
});
test("save and reopen an editable project, then export a range as images and text", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新規作成", exact: true }).click();
  await page.getByRole("button", { name: "テキスト", exact: true }).click();
  const box = await page.locator(".viewer-scroll .page-view").boundingBox();
  if (!box) throw Error("no page");
  await page.mouse.click(box.x + 80, box.y + 90);
  await page.getByLabel("テキスト内容").fill("後から再編集");
  let download = page.waitForEvent("download");
  await menu(page, "編集プロジェクトを保存");
  const project = info.outputPath("editable.kpdf");
  await (await download).saveAs(project);
  // Save the PDF as well so reload does not need to discard unsaved recovery data.
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await download;
  await page.reload();
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "編集プロジェクトを開く");
  await (await chooser).setFiles(project);
  await expect(page.locator(".viewer-scroll .object-layer text")).toContainText(
    "後から再編集",
  );
  await page.locator(".viewer-scroll .object-layer > g").click();
  await page.getByLabel("テキスト内容").fill("変更して出力");
  await menu(page, "ページを一括画像出力（ZIP）");
  await page.getByLabel("解像度（dpi）").selectOption("72");
  download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  const archive = info.outputPath("pages.zip");
  await (await download).saveAs(archive);
  const files = unzipSync(await readFile(archive));
  expect(Object.keys(files)).toEqual(["page-0001.png"]);
  expect(Array.from(files["page-0001.png"].slice(0, 4))).toEqual([
    137, 80, 78, 71,
  ]);
  await menu(page, "テキストを抽出");
  download = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "適用", exact: true })
    .click();
  const txt = info.outputPath("document.txt");
  await (await download).saveAs(txt);
  expect(await readFile(txt, "utf8")).toContain("変更して出力");
  expect(errors).toEqual([]);
});
