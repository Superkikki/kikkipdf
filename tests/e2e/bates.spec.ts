import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { blankPage, emptyDocument } from "../../src/state/model";
import { saveProject, openProject } from "../../src/state/project";
async function fixture() {
  const pdf=await PDFDocument.create(); for(let i=0;i<4;i++) pdf.addPage([300,400]);
  const d=emptyDocument(); d.sources.s={id:"s",name:"source.pdf",bytes:await pdf.save()};
  d.pages=Array.from({length:4},(_,i)=>({ ...blankPage(), sourceId:"s", sourceIndex:i, width:300,height:400,rotation:i*90,crop:{x:10,y:20,width:250,height:350} }));
  return Buffer.from(await saveProject(d));
}
test("previews, validates, adds and saves Bates numbers for cropped rotated pages", async ({page},info) => {
  const errors:string[]=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/"); await page.keyboard.press("Escape"); const chooser=page.waitForEvent("filechooser"); await page.getByRole("button",{name:"PDFを開く",exact:true}).click(); await (await chooser).setFiles({name:"bates.kpdf",mimeType:"application/zip",buffer:await fixture()});
  await page.getByRole("button",{name:"ページ管理",exact:true}).click(); await page.getByRole("button",{name:"ベイツ番号",exact:true}).click(); const dialog=page.getByRole("dialog",{name:"ベイツ番号を追加",exact:true});
  await expect(dialog.getByLabel("ベイツ番号を付けるページ範囲")).toBeFocused(); await dialog.getByLabel("ベイツ番号の接頭辞").fill("CASE-"); await dialog.getByLabel("ベイツ番号の開始番号").fill("98"); await dialog.getByLabel("ベイツ番号の桁数").fill("2");
  await expect(dialog.getByRole("alert")).toContainText("桁数"); await expect(dialog.getByRole("button",{name:"番号を追加",exact:true})).toBeDisabled(); await dialog.getByLabel("ベイツ番号の桁数").fill("3");
  await expect(dialog.locator("tbody tr")).toHaveText(["1CASE-098","2CASE-099","3CASE-100","4CASE-101"]); await page.screenshot({path:info.outputPath("bates-preview.png")}); await dialog.getByRole("button",{name:"番号を追加",exact:true}).click();
  await page.getByTitle("元に戻す (Ctrl+Z)").click(); await page.getByTitle("やり直す (Ctrl+Y)").click(); let download=page.waitForEvent("download"); await page.locator("summary").filter({hasText:/^ファイル$/}).click(); await page.getByRole("button",{name:"編集プロジェクトを保存",exact:true}).click();
  const project=info.outputPath("numbered.kpdf"); await (await download).saveAs(project); const restored=await openProject(new Uint8Array(await readFile(project))); expect(restored.pages.map(p=>p.objects[0].text)).toEqual(["CASE-098","CASE-099","CASE-100","CASE-101"]);
  download=page.waitForEvent("download"); await page.getByRole("button",{name:"保存",exact:true}).click(); const output=info.outputPath("numbered.pdf"); await (await download).saveAs(output);
  const pdfBytes=Array.from(await readFile(output)); const lines=await page.evaluate(async bytes=>{
    const modulePath="/src/viewer/pdf.ts"; const { sourcePdf }=await import(modulePath) as typeof import("../../src/viewer/pdf"); const doc=await sourcePdf({id:crypto.randomUUID(),name:"test.pdf",bytes:new Uint8Array(bytes)}); const result=[];
    for(let i=1;i<=4;i++){ const p=await doc.getPage(i), viewport=p.getViewport({scale:1}), content=await p.getTextContent(); const item=content.items.find(item=>"str" in item && item.str.startsWith("CASE-")); if (!item || !("str" in item)) throw Error("missing number"); const point=viewport.convertToViewportPoint(item.transform[4],item.transform[5]); result.push({ text:item.str, x:point[0], y:point[1], width:viewport.width, height:viewport.height }); } await doc.loadingTask.destroy(); return result;
  },pdfBytes);
  expect(lines.map(line=>line.text)).toEqual(["CASE-098","CASE-099","CASE-100","CASE-101"]); for(const line of lines){expect(line.x).toBeGreaterThan(line.width-100);expect(line.y).toBeGreaterThan(line.height-50);expect(line.y).toBeLessThan(line.height-20);} expect(errors).toEqual([]);
});
test("keeps controls visible in a small window and cancel does not alter document", async ({page}) => {
 await page.setViewportSize({width:960,height:600}); await page.goto("/"); await page.keyboard.press("Escape"); const chooser=page.waitForEvent("filechooser"); await page.getByRole("button",{name:"PDFを開く",exact:true}).click(); await (await chooser).setFiles({name:"bates.kpdf",mimeType:"application/zip",buffer:await fixture()});
 await page.getByRole("button",{name:"ページ管理",exact:true}).click(); await page.getByRole("button",{name:"ベイツ番号",exact:true}).click(); const dialog=page.getByRole("dialog",{name:"ベイツ番号を追加",exact:true}); const dirtyBefore=await page.locator(".unsaved-dot").count(); await expect(dialog.getByRole("button",{name:"番号を追加",exact:true})).toBeInViewport(); await expect(dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).resolves.toBeLessThanOrEqual(1); await dialog.getByRole("button",{name:"キャンセル",exact:true}).click(); await expect(page.locator(".unsaved-dot")).toHaveCount(dirtyBefore);
});
