import { it, expect } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { blankPage, emptyDocument } from "../src/state/model";
import { exportPdf } from "../src/export/engine";
import {
  attachmentEntries,
  extractAttachment,
  inspectAttachments,
} from "../src/attachments/pdfAttachments";
import {
  addAttachments,
  attachmentName,
  editAttachment,
} from "../src/attachments/model";
import { History } from "../src/commands/history";
import { openProject, saveProject } from "../src/state/project";
const key = PDFName.of;
const bytes = new TextEncoder().encode("添付データ\n1,2,3");
async function fixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  await pdf.attach(bytes, "資料.csv", { description: "元の説明" });
  await pdf.flush();
  const tree = pdf.catalog
    .lookup(key("Names"), PDFDict)
    .lookup(key("EmbeddedFiles"), PDFDict);
  const spec = tree.lookup(key("Names"), PDFArray).get(1);
  page.node.addAnnot(
    pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "FileAttachment",
        FS: spec,
        Rect: [20, 20, 45, 45],
        P: page.ref,
      }),
    ),
  );
  // Exercise a multi-level name tree; AF + page annotation must not create duplicates.
  pdf.catalog
    .lookup(key("Names"), PDFDict)
    .set(
      key("EmbeddedFiles"),
      pdf.context.obj({ Kids: [pdf.context.register(tree)] }),
    );
  const d = emptyDocument();
  d.sources.s = { id: "s", name: "attachments.pdf", bytes: await pdf.save() };
  d.pages = [{ ...blankPage(), sourceId: "s", sourceIndex: 0 }];
  return d;
}
it("preserves nested embedded files and page pins with Japanese names and deduplication", async () => {
  const model = await fixture();
  const list = await inspectAttachments(model);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    name: "資料.csv",
    description: "元の説明",
    pages: [0],
    size: bytes.length,
  });
  expect(await extractAttachment(model, list[0].id)).toEqual(bytes);
  const h = new History(model);
  h.execute(
    editAttachment(list[0].id, {
      name: "改訂.csv",
      description: "変更した説明",
    }),
  );
  h.execute(
    addAttachments([
      { id: "new", name: "改訂.csv", description: "追加", bytes },
    ]),
  );
  const out = await PDFDocument.load(await exportPdf(h.current.document));
  const entries = attachmentEntries(out, "out");
  expect(entries.map((a) => a.name).sort()).toEqual([
    "改訂 (2).csv",
    "改訂.csv",
  ]);
  expect(entries.find((a) => a.name === "改訂.csv")?.description).toBe(
    "変更した説明",
  );
  const pin = out
    .getPage(0)
    .node.Annots()!
    .lookup(0, PDFDict)
    .lookup(key("FS"), PDFDict);
  expect(entries.some((a) => a.spec === pin)).toBe(true);
  const roundTrip = await openProject(await saveProject(h.current.document));
  expect(roundTrip.attachments?.[0].bytes).toEqual(bytes);
  expect(roundTrip.attachmentEdits).toEqual(h.current.document.attachmentEdits);
});
it("removes embedded bytes and pin references on delete, and restores them on undo", async () => {
  const model = await fixture(),
    h = new History(model);
  const id = (await inspectAttachments(model))[0].id;
  h.execute(editAttachment(id, { deleted: true }));
  const removed = await PDFDocument.load(await exportPdf(h.current.document));
  expect(attachmentEntries(removed, "out")).toHaveLength(0);
  expect(removed.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  expect(
    removed.context
      .enumerateIndirectObjects()
      .filter(
        ([, obj]) =>
          obj instanceof PDFRawStream &&
          obj.dict.get(key("Type")) === key("EmbeddedFile"),
      ),
  ).toHaveLength(0);
  h.undo();
  expect(
    attachmentEntries(
      await PDFDocument.load(await exportPdf(h.current.document)),
      "out",
    ),
  ).toHaveLength(1);
  const extracted = await PDFDocument.load(
    await exportPdf(model, undefined, { indices: [0] }),
  );
  expect(attachmentEntries(extracted, "out")).toHaveLength(0);
  expect(extracted.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
});
it("treats attachment filenames as basenames and rejects oversized extraction metadata", async () => {
  expect(attachmentName("../../windows\\CON.txt")).toBe("_CON.txt");
  expect(attachmentName("..\u0000/資料.csv")).toBe("資料.csv");
  expect(attachmentName("...")).toBe("attachment.bin");
  const model = await fixture(),
    input = await PDFDocument.load(model.sources.s.bytes);
  const entry = attachmentEntries(input, "s")[0];
  entry.stream.dict.set(
    key("Params"),
    input.context.obj({ Size: 129 * 1024 * 1024 }),
  );
  model.sources.s.bytes = await input.save();
  await expect(extractAttachment(model, entry.id)).rejects.toThrow("128MB");
});
