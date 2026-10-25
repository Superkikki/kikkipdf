import { expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFNumber } from "pdf-lib";
import { unzipSync } from "fflate";
import { emptyDocument, blankPage } from "../src/state/model";
import { attachmentName } from "../src/attachments/model";
import { History } from "../src/commands/history";
import { inspectAttachments, attachmentEntries } from "../src/attachments/pdfAttachments";
import { attachmentItems, filterAttachments, batchAttachmentDeletion } from "../src/attachments/batch";
import { attachmentsZip } from "../src/attachments/archive";
import { saveProject, openProject } from "../src/state/project";
import { exportPdf } from "../src/export/engine";
const data = (text: string) => new TextEncoder().encode(text);
async function fixture(sizes: number[] = []) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  await pdf.attach(data("Original"), "file.txt", { description: "日本語の資料" });
  await pdf.attach(data("Other"), "other.txt");
  await pdf.flush();
  if (sizes.length) attachmentEntries(pdf, "s").forEach((entry, i) => entry.stream.dict.lookup(PDFName.of("Params"), PDFDict).set(PDFName.of("Size"), PDFNumber.of(sizes[i] ?? 0)));
  const d = emptyDocument(); d.sources.s = { id: "s", name: "source.pdf", bytes: await pdf.save() };
  d.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  d.attachments = [{ id: "added", name: "FILE.txt", description: "Added", bytes: data("追加") }];
  return { d, imported: await inspectAttachments(d) };
}
it("archives original and added attachments in selection order with safe unique names and unchanged data/history", async () => {
  const { d, imported } = await fixture();
  d.attachmentEdits = { [imported[0].id]: { name: "../../file.txt" }, [imported[1].id]: { deleted: true } };
  d.attachments!.push({ id: "japanese", name: "日本語.txt", description: "", bytes: data("日本語") });
  const rows = attachmentItems(d, imported), h = new History(d), progress: number[] = [];
  const zip = unzipSync(await attachmentsZip(d, [imported[0].id, "added", "japanese"], n => progress.push(n)));
  expect(Object.keys(zip)).toEqual(["file.txt", "FILE (2).txt", "日本語.txt"]);
  expect(zip["file.txt"]).toEqual(data("Original")); expect(zip["FILE (2).txt"]).toEqual(data("追加")); expect(zip["日本語.txt"]).toEqual(data("日本語"));
  expect(progress.at(-1)).toBe(1); expect(h.canUndo).toBe(false); expect(d.attachments![0].bytes).toEqual(data("追加"));
  expect(filterAttachments(rows, "日本語", false)).toHaveLength(2);
  expect(filterAttachments(rows, "ｆｉｌｅ", false)).toHaveLength(2);
  expect(filterAttachments(rows, "", true).map(a => a.id)).toEqual([imported[1].id]);
});
it("deletes/restores mixed attachments atomically with undo, metadata and PDF/project persistence", async () => {
  const { d, imported } = await fixture(); d.attachmentEdits = { [imported[0].id]: { name: "Renamed.txt", description: "Edited" } };
  const ids = [imported[0].id, "added"], h = new History(d);
  h.execute(batchAttachmentDeletion(d, imported, ids, true)); const removed = h.current;
  expect(filterAttachments(attachmentItems(removed.document, imported), "", true)).toHaveLength(2);
  expect(attachmentEntries(await PDFDocument.load(await exportPdf(removed.document)), "out")).toHaveLength(1);
  const reopened = await openProject(await saveProject(removed.document));
  h.undo(); expect(h.current.document).toBe(d); h.redo(); expect(h.current).toBe(removed);
  const restored = batchAttachmentDeletion(reopened, await inspectAttachments(reopened), ids, false).apply(reopened);
  expect(restored.attachmentEdits![ids[0]]).toEqual({ name: "Renamed.txt", description: "Edited", deleted: false });
  expect(attachmentEntries(await PDFDocument.load(await exportPdf(restored)), "out").map(a => a.name).sort()).toEqual(["FILE.txt", "Renamed.txt", "other.txt"]);
  expect(Object.keys(unzipSync(await attachmentsZip(restored, ids)))).toEqual(["Renamed.txt", "FILE.txt"]);
});
it("rejects stale, duplicate, missing, out-of-scope and wrongly deleted targets without changing history", async () => {
  const { d, imported } = await fixture(), h = new History(d), id = imported[0].id;
  for (const ids of [[], [id, id], ["missing"], Array.from({ length: 1001 }, (_, i) => `a${i}`)]) {
    expect(() => h.execute(batchAttachmentDeletion(d, imported, ids, true))).toThrow();
    await expect(attachmentsZip(d, ids)).rejects.toThrow();
  }
  expect(() => h.execute(batchAttachmentDeletion(d, imported, [id], false))).toThrow(/削除状態/);
  expect(() => batchAttachmentDeletion(d, imported, [id], true).apply({ ...d })).toThrow(/変更/);
  const scoped = imported.map(a => ({ ...a, documentLevel: false, pages: [1] }));
  expect(() => batchAttachmentDeletion(d, scoped, [id], true)).toThrow();
  d.attachmentEdits = { [id]: { deleted: true } }; await expect(attachmentsZip(d, [id])).rejects.toThrow(/削除状態/);
  expect(h.canUndo).toBe(false);
  expect(() => attachmentItems({ ...d, attachments: [...d.attachments!, d.attachments![0]] }, imported)).toThrow(/重複/);
});
it("rejects advertised per-file/total oversize, accepts unknown sizes and bounds batch count", async () => {
  const huge = await fixture([128 * 1024 * 1024 + 1]); await expect(attachmentsZip(huge.d, [huge.imported[0].id])).rejects.toThrow(/128MB/);
  const total = await fixture([128 * 1024 * 1024, 128 * 1024 * 1024]); await expect(attachmentsZip(total.d, [...total.imported.map(a => a.id), "added"])).rejects.toThrow(/256MB/);
  const unknown = await fixture(); const raw = await PDFDocument.load(unknown.d.sources.s.bytes);
  for (const entry of attachmentEntries(raw, "s")) entry.stream.dict.delete(PDFName.of("Params"));
  unknown.d.sources.s.bytes = await raw.save(); expect(Object.keys(unzipSync(await attachmentsZip(unknown.d, [unknown.imported[0].id])))).toEqual(["file.txt"]);
  const many = emptyDocument(); many.pages = [blankPage()]; many.attachments = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}`, name: "CON", description: "", bytes: new Uint8Array() }));
  const zip = unzipSync(await attachmentsZip(many, many.attachments.map(a => a.id)));
  expect(Object.keys(zip)).toHaveLength(1000); expect(Object.keys(zip)[0]).toBe("_CON");
});

it("sanitizes trailing dots introduced by truncating long archive names", () => {
  expect(attachmentName("x".repeat(179) + ".tail")).toBe("x".repeat(179));
});

it("excludes page-only attachments after their source page is removed", async () => {
  const pdf = await PDFDocument.create(), first = pdf.addPage(); pdf.addPage();
  await pdf.attach(data("Pinned"), "pinned.txt"); await pdf.flush();
  const spec = attachmentEntries(pdf, "s")[0].spec;
  first.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [10, 10, 30, 30], FS: spec })));
  pdf.catalog.delete(PDFName.of("Names")); pdf.catalog.delete(PDFName.of("AF"));
  const d = emptyDocument(); d.sources.s = { id: "s", name: "pin.pdf", bytes: await pdf.save() };
  d.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 1 }];
  const imported = await inspectAttachments(d); expect(imported[0]).toMatchObject({ documentLevel: false, pages: [0] });
  expect(attachmentItems(d, imported)).toEqual([]); await expect(attachmentsZip(d, [imported[0].id])).rejects.toThrow(/見つからない/);
  d.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }]; expect(Object.keys(unzipSync(await attachmentsZip(d, [imported[0].id])))).toEqual(["pinned.txt"]);
});
