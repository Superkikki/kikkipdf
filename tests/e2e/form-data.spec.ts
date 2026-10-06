import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFHexString } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { openProject } from "../../src/state/project";

async function open(page: Page) {
  const pdf = await PDFDocument.create(), sheet = pdf.addPage(), form = pdf.getForm();
  const text = form.createTextField("Customer.Name"); text.setText("Before"); text.enableMultiline(); text.setMaxLength(20); text.addToPage(sheet, { x: 30, y: 650, width: 180, height: 30 });
  const check = form.createCheckBox("Agree"); check.addToPage(sheet, { x: 30, y: 600 });
  const radio = form.createRadioGroup("Choice"); radio.addOptionToPage("A", sheet, { x: 30, y: 550 }); radio.addOptionToPage("B", sheet, { x: 80, y: 550 }); radio.select("B");
  const dropdown = form.createDropdown("Color"); dropdown.setOptions(["Red", "Green"]); dropdown.addToPage(sheet, { x: 30, y: 480, width: 180, height: 30 });
  dropdown.acroField.setOptions([{ value: PDFHexString.fromText("R"), display: PDFHexString.fromText("Red") }, { value: PDFHexString.fromText("G"), display: PDFHexString.fromText("Green") }]); dropdown.select("R");
  const list = form.createOptionList("Tags"); list.setOptions(["One", "Two", "Three"]); list.enableMultiselect(); list.select(["One", "Three"]); list.addToPage(sheet, { x: 30, y: 350, width: 180, height: 90 });
  await page.goto("/"); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click();
  await (await chooser).setFiles({ name: "form-data.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await showForm(page);
}
async function showForm(page: Page) {
  await page.getByRole("button", { name: "ツール", exact: true }).click(); await page.getByRole("button", { name: "フォーム入力", exact: true }).click();
  await expect(page.getByRole("button", { name: "フォーム値をXFDF読み込み", exact: true })).toBeEnabled();
}
const wrap = (fields: string) => `<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><fields>${fields}</fields></xfdf>`;
const valid = wrap('<field name="Customer"><field name="Name"><value><![CDATA[日本語 <&>]]>&#13;&#10;二行目</value></field></field><field name="Agree"><value>Yes</value></field><field name="Choice"><value>A</value></field><field name="Color"><value>G</value></field><field name="Tags"><value>Two</value></field>');
async function importData(page: Page, xml: string, utf16 = false) {
  const picker = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "フォーム値をXFDF読み込み", exact: true }).click();
  await (await picker).setFiles({ name: "values.xfdf", mimeType: "application/vnd.adobe.xfdf", buffer: utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]) : Buffer.from(xml) });
}
test("imports nested UTF16 form values, undoes atomically, and saves XFDF, project and PDF", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await open(page);
  await importData(page, valid, true); const dialog = page.locator("dialog");
  await expect(dialog.getByLabel("Customer.Name", { exact: true })).toHaveValue("日本語 <&>\n二行目");
  await expect(dialog.getByLabel("Agree", { exact: true })).toBeChecked(); await expect(dialog.getByLabel("Choice", { exact: true })).toHaveValue("A");
  await expect(dialog.getByLabel("Color", { exact: true })).toHaveValue("G"); await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValues(["Two"]);
  await page.getByRole("button", { name: "完了", exact: true }).click(); await page.getByRole("button", { name: /^元に戻す/ }).click();
  await showForm(page); await expect(dialog.getByLabel("Customer.Name", { exact: true })).toHaveValue("Before"); await expect(dialog.getByLabel("Agree", { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "完了", exact: true }).click(); await page.getByRole("button", { name: /^やり直す/ }).click(); await showForm(page);
  let download = page.waitForEvent("download"); await page.getByRole("button", { name: "フォーム値をXFDF保存", exact: true }).click();
  const xfdf = info.outputPath("data.xfdf"); await (await download).saveAs(xfdf);
  const xml = await readFile(xfdf, "utf8"); expect(xml).toContain('name="Customer.Name"'); expect(xml).toContain('&lt;&amp;&gt;&#13;&#10;'); expect(xml).toContain('name="Color"><value>G</value>');
  await page.getByRole("button", { name: "入力値を読み込み時に戻す", exact: true }).click(); await expect(dialog.getByLabel("Choice", { exact: true })).toHaveValue("B");
  await page.getByRole("button", { name: "完了", exact: true }).click(); await page.getByRole("button", { name: /^元に戻す/ }).click();
  download = page.waitForEvent("download"); await page.getByText("ファイル", { exact: true }).click(); await page.getByRole("button", { name: "編集プロジェクトを保存", exact: true }).click();
  const project = info.outputPath("data.kpdf"); await (await download).saveAs(project); const model = await openProject(new Uint8Array(await readFile(project)));
  expect(Object.values(model.formValues)).toContain("日本語 <&>\r\n二行目");
  download = page.waitForEvent("download"); await page.getByRole("button", { name: "保存", exact: true }).click(); const output = info.outputPath("data.pdf"); await (await download).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output)), form = pdf.getForm(); expect(form.getTextField("Customer.Name").getText()).toBe("日本語 <&>\r\n二行目");
  expect(form.getCheckBox("Agree").isChecked()).toBe(true); expect(form.getRadioGroup("Choice").getSelected()).toBe("A"); expect(form.getDropdown("Color").getSelected()).toEqual(["G"]); expect(form.getOptionList("Tags").getSelected()).toEqual(["Two"]);
  await page.reload(); const chooser = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "PDFを開く", exact: true }).click(); await (await chooser).setFiles(output); await showForm(page);
  await expect(dialog.getByLabel("Agree", { exact: true })).toBeChecked(); await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValues(["Two"]); expect(errors).toEqual([]);
});
test("rejects malformed and incompatible XFDF without partial changes or history", async ({ page }) => {
  await open(page); const good = '<field name="Customer.Name"><value>Changed</value></field>';
  const invalid = [wrap(good + '<field name="Choice"><value>Unknown</value></field>'), wrap(good + '<field name="Missing"><value>x</value></field>'), wrap(good + good),
    wrap('<field name="Customer.Name"><value>123456789012345678901</value></field>'), wrap('<field name="Agree"><value>true</value></field>'),
    wrap('<field name="Customer.Name"><value><b>Rich</b></value></field>'), wrap('<field name="Customer.Name"><value>x</value><field name="Nested"><value>y</value></field></field>'),
    '<!DOCTYPE xfdf [<!ENTITY test "value">]>' + wrap(good), wrap(good).replace('http://ns.adobe.com/xfdf/', 'https://invalid.example/'),
    wrap(good).replace('</xfdf>', '<annots><text/></annots></xfdf>'), wrap(good).replace('</xfdf>', '<fields/></xfdf>'), '<xfdf>' ];
  for (const xml of invalid) {
    await importData(page, xml); await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.locator("dialog").getByLabel("Customer.Name", { exact: true })).toHaveValue("Before"); await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "完了", exact: true }).click(); await expect(page.getByRole("button", { name: /^元に戻す/ })).toBeDisabled();
});
test("round trips empty selections and preserves read-only values", async ({ page }, info) => {
  await open(page); await importData(page, wrap('<field name="Choice"/><field name="Tags"/><field name="Color"/>'));
  const dialog = page.locator("dialog"); await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValues([]); await expect(dialog.getByLabel("Choice", { exact: true })).toHaveValue("");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "フォーム値をXFDF保存", exact: true }).click(); const path = info.outputPath("empty.xfdf"); await (await download).saveAs(path);
  await page.getByRole("button", { name: "入力値を読み込み時に戻す", exact: true }).click(); await importData(page, await readFile(path, "utf8")); await expect(dialog.getByLabel("Tags", { exact: true })).toHaveValues([]);
  await page.getByRole("button", { name: "フォームを作成・編集", exact: true }).click(); const select = page.getByLabel("既存の入力欄", { exact: true });
  const option = select.locator("option").filter({ hasText: "Customer.Name —" }).first(); await select.selectOption((await option.getAttribute("value"))!);
  await page.getByLabel("既存フィールド読み取り専用", { exact: true }).check(); await page.getByRole("button", { name: "設定を適用", exact: true }).click(); await page.getByRole("button", { name: "値を入力", exact: true }).click();
  await importData(page, wrap('<field name="Customer.Name"><value>Changed</value></field>')); await expect(page.getByRole("alert")).toContainText("読み取り専用");
  await importData(page, wrap('<field name="Customer.Name"><value>Before</value></field>')); await expect(page.getByRole("alert")).toHaveCount(0);
});
