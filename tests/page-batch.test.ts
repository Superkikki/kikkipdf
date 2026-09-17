import { expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { unzipSync } from "fflate";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { History } from "../src/commands/history";
import { batchPageCommand } from "../src/pages/batchOperations";
import { splitPdfZip } from "../src/export/split";
function fixture() {
  const d = emptyDocument();
  d.pages = Array.from({ length: 5 }, (_, i) => ({
    ...blankPage(),
    width: 300 + i * 10,
  }));
  return d;
}
it("rotates and reverses selected page slots as one undoable operation", () => {
  const d = fixture(),
    h = new History(d),
    ids = [d.pages[0].id, d.pages[2].id, d.pages[4].id];
  h.execute(batchPageCommand(ids, "rotateLeft"));
  expect(h.current.document.pages.map((p) => p.rotation)).toEqual([
    270, 0, 270, 0, 270,
  ]);
  h.undo();
  expect(h.current.document).toBe(d);
  h.redo();
  h.execute(batchPageCommand(ids, "reverse"));
  expect(h.current.document.pages.map((p) => p.id)).toEqual([
    d.pages[4].id,
    d.pages[1].id,
    d.pages[2].id,
    d.pages[3].id,
    d.pages[0].id,
  ]);
  h.undo();
  expect(h.current.document.pages[0].id).toBe(d.pages[0].id);
  expect(() =>
    h.execute(
      batchPageCommand(
        d.pages.map((p) => p.id),
        "delete",
      ),
    ),
  ).toThrow("最後のページ");
  expect(h.current.document.pages).toHaveLength(5);
});
it("duplicates multiple pages with unique object identities and resets only app crops", () => {
  const d = fixture(),
    h = new History(d);
  d.pages[0].objects = [newObject("rect", 20, 30)];
  d.pages[0].crop = { x: 10, y: 10, width: 100, height: 100 };
  h.execute(batchPageCommand([d.pages[0].id, d.pages[2].id], "duplicate"));
  expect(h.current.document.pages).toHaveLength(7);
  expect(new Set(h.current.document.pages.map((p) => p.id)).size).toBe(7);
  expect(h.current.document.pages[1].objects[0].id).not.toBe(
    d.pages[0].objects[0].id,
  );
  h.undo();
  expect(h.current.document.pages).toHaveLength(5);
  h.execute(batchPageCommand([d.pages[0].id], "resetCrop"));
  expect(h.current.document.pages[0].crop).toBeUndefined();
  h.undo();
  expect(h.current.document.pages[0].crop).toEqual(d.pages[0].crop);
});
it("splits an ordered range into readable PDFs inside one ZIP without attachments", async () => {
  const model = fixture();
  model.attachments = [
    {
      id: "file",
      name: "secret.txt",
      description: "",
      bytes: new TextEncoder().encode("test attachment"),
    },
  ];
  const progress: number[] = [];
  const files = unzipSync(
    await splitPdfZip(model, [4, 0, 1], 2, undefined, (n) => progress.push(n)),
  );
  expect(Object.keys(files)).toEqual(["part-0001.pdf", "part-0002.pdf"]);
  const first = await PDFDocument.load(files["part-0001.pdf"]),
    last = await PDFDocument.load(files["part-0002.pdf"]);
  expect(first.getPages().map((p) => p.getWidth())).toEqual([340, 300]);
  expect(last.getPageCount()).toBe(1);
  expect(last.getPage(0).getWidth()).toBe(310);
  expect(first.catalog.has(PDFName.of("AF"))).toBe(false);
  expect(progress.at(-1)).toBe(1);
  await expect(splitPdfZip(model, [0], 0)).rejects.toThrow("不正");
  model.pages[0].objects = [newObject("redaction", 10, 10)];
  await expect(splitPdfZip(model, [0], 1)).rejects.toThrow("墨消し");
});
