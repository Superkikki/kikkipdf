import { expect, test } from "@playwright/test";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { readFile } from "node:fs/promises";

test("searches, filters, edits, undoes, saves and reopens PDF comments", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = await PDFDocument.create();
  const first = source.addPage(), second = source.addPage();
  const addComment = (pdfPage: typeof first, text: string, author: string, state: string) => {
    const ref = source.context.register(source.context.obj({
      Type: "Annot", Subtype: "Text", Rect: [30, 30, 60, 60],
      Contents: PDFHexString.fromText(text), T: PDFHexString.fromText(author),
      StateModel: PDFString.of("Review"), State: PDFString.of(state), P: pdfPage.ref,
    }));
    pdfPage.node.addAnnot(ref);
  };
  addComment(first, "Check the introduction", "Alice", "Accepted");
  addComment(second, "Revise the appendix", "Bob", "Rejected");

  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({
    name: "comments.pdf", mimeType: "application/pdf", buffer: Buffer.from(await source.save()),
  });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  const cards = page.locator(".comment-card");
  await expect(cards).toHaveCount(2);

  await page.getByLabel("コメントを検索").fill("ALICE");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Check the introduction");
  await page.getByLabel("コメントを検索").fill("");
  await page.getByLabel("コメントの作成者で絞り込み").selectOption({ label: "Alice" });
  await page.getByLabel("コメントの状態で絞り込み").selectOption("Accepted");
  await page.getByLabel("コメントのページで絞り込み").selectOption({ label: "ページ 1" });
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "絞り込みを解除" }).click();

  await cards.filter({ hasText: "Check the introduction" }).click();
  await page.getByLabel("コメント内容").fill("Updated introduction");
  await page.getByRole("textbox", { name: "コメントの作成者" }).fill("Carol");
  await page.getByLabel("コメントのレビュー状態").selectOption("Completed");
  await expect(cards.first()).toContainText("Carol");
  await expect(cards.first()).toContainText("完了");
  await page.screenshot({ path: info.outputPath("comments-panel.png") });

  const undo = page.getByRole("button", { name: /^元に戻す/ });
  await undo.click();
  await expect(page.getByLabel("コメントのレビュー状態")).toHaveValue("Accepted");
  await undo.click();
  await expect(page.getByRole("textbox", { name: "コメントの作成者" })).toHaveValue("Alice");
  await undo.click();
  await expect(page.getByLabel("コメント内容")).toHaveValue("Check the introduction");
  await page.getByLabel("コメント内容").fill("Updated introduction");
  await page.getByRole("textbox", { name: "コメントの作成者" }).fill("Carol");
  await page.getByLabel("コメントのレビュー状態").selectOption("Completed");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const savedPath = info.outputPath("comments-edited.pdf");
  await (await download).saveAs(savedPath);
  const exported = await PDFDocument.load(new Uint8Array(await readFile(savedPath)));
  const savedAnnots = exported.getPage(0).node.Annots()!;
  const savedComment = savedAnnots.lookup(0, PDFDict);
  expect(savedComment.lookup(PDFName.of("Contents"), PDFHexString).decodeText()).toBe("Updated introduction");
  expect(savedComment.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("Carol");
  expect(savedComment.lookup(PDFName.of("State"), PDFString).decodeText()).toBe("Completed");

  await page.reload();
  const reopened = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await reopened).setFiles({ name: "comments-edited.pdf", mimeType: "application/pdf", buffer: await readFile(savedPath) });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card")).toHaveCount(2);
  await expect(page.locator(".comment-card").first()).toContainText("Updated introduction");
  await expect(page.locator(".comment-card").first()).toContainText("Carol");
  await expect(page.locator(".comment-card").first()).toContainText("完了");
  expect(errors).toEqual([]);
});

test("paginates large comment lists in batches of 100", async ({ page }) => {
  const pdf = await PDFDocument.create();
  const sourcePage = pdf.addPage();
  for (let i = 0; i < 205; i++) {
    const ref = pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30],
      Contents: PDFHexString.fromText(`Comment ${i + 1}`), P: sourcePage.ref,
    }));
    sourcePage.node.addAnnot(ref);
  }
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "many-comments.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card")).toHaveCount(100);
  await page.getByRole("button", { name: "次の100件" }).click();
  await expect(page.locator(".comment-card").first()).toContainText("Comment 101");
  await page.getByLabel("コメントを検索").fill("Comment 205");
  await expect(page.locator(".comment-card")).toHaveCount(1);
  await expect(page.locator(".comment-card").first()).toContainText("Comment 205");
});

test("exports every comment and the filtered live result without changing history", async ({ page }, info) => {
  const pdf = await PDFDocument.create();
  const sourcePage = pdf.addPage();
  for (let i = 0; i < 105; i++) {
    const ref = pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30],
      Contents: PDFHexString.fromText(`Comment ${i + 1}`),
      T: PDFHexString.fromText(i === 104 ? "Special" : "Reviewer"), P: sourcePage.ref,
    }));
    sourcePage.node.addAnnot(ref);
  }
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "csv-comments.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await page.getByRole("button", { name: "コメント", exact: true }).click();
  await expect(page.locator(".comment-card")).toHaveCount(100);

  const firstCard = page.locator(".comment-card").filter({ hasText: "Comment 1" }).first();
  await firstCard.click();
  await page.getByLabel("コメント内容").fill("Edited live comment");
  const secondCard = page.locator(".comment-card").filter({ hasText: "Comment 2" }).first();
  await secondCard.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "コメントを削除" }).click();

  const allDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "全件をCSV保存" }).click();
  const allPath = info.outputPath("comments-all.csv");
  await (await allDownload).saveAs(allPath);
  const allBytes = await readFile(allPath);
  expect([...allBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const allCsv = allBytes.toString("utf8");
  expect(allCsv).toContain('"ページ","作成者","レビュー状態","コメント","区分"');
  expect(allCsv).toContain('"1","Reviewer","未確認","Edited live comment","既存"');
  expect(allCsv).not.toContain('"1","Reviewer","未確認","Comment 2","既存"');
  expect(allCsv.match(/\r\n/g)).toHaveLength(105);

  await page.getByLabel("コメントの作成者で絞り込み").selectOption({ label: "Special" });
  const filteredDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "絞り込み結果をCSV保存" }).click();
  const filteredPath = info.outputPath("comments-filtered.csv");
  await (await filteredDownload).saveAs(filteredPath);
  const filteredBytes = await readFile(filteredPath);
  expect([...filteredBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(filteredBytes.toString("utf8")).toBe('\uFEFF"ページ","作成者","レビュー状態","コメント","区分"\r\n"1","Special","未確認","Comment 105","既存"\r\n');
  await page.screenshot({ path: info.outputPath("comments-csv-buttons.png") });

  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await page.getByLabel("コメントの作成者で絞り込み").selectOption({ label: "Reviewer" });
  await expect(page.getByText("104 / 105 件", { exact: true })).toBeVisible();
  await page.locator(".comment-card").filter({ hasText: "Edited live comment" }).click();
  await expect(page.getByLabel("コメント内容")).toHaveValue("Edited live comment");
  await page.getByRole("button", { name: /^元に戻す/ }).click();
  await expect(page.getByLabel("コメント内容")).toHaveValue("Comment 1");
});
