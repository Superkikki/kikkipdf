import { describe, expect, it } from "vitest";
import { renameDocument } from "../src/commands/document";
import { History } from "../src/commands/history";
import { emptyDocument } from "../src/state/model";

describe("document renaming", () => {
  it("uses the new name for Save and restores the original destination on undo", () => {
    const doc = { ...emptyDocument(), name: "original.pdf", path: "/documents/original.pdf" };
    const history = new History(doc);
    history.execute(renameDocument("  会議資料.PDF  "));
    expect(history.current.document.name).toBe("会議資料.pdf");
    expect(history.current.document.path).toBeUndefined();
    expect(history.dirty).toBe(true);
    expect(doc.path).toBe("/documents/original.pdf");
    history.undo();
    expect(history.current.document).toBe(doc);
    expect(history.dirty).toBe(false);
    history.redo();
    expect(history.current.document.name).toBe("会議資料.pdf");
    expect(history.current.document.path).toBeUndefined();
  });
  it("keeps the destination and history when the name is unchanged", () => {
    const doc = { ...emptyDocument(), name: "original.pdf", path: "/documents/original.pdf" };
    const history = new History(doc);
    history.execute(renameDocument("original"));
    expect(history.current.document).toBe(doc);
    expect(history.canUndo).toBe(false);
    expect(history.dirty).toBe(false);
  });
  it.each(["", " ", ".pdf", "../file", "a\\b", "a:b", "a?b", "file.", "CON", "nul.txt", "a\u0000b", "a".repeat(201)])("rejects invalid file names: %s", (name) => {
    expect(() => renameDocument(name)).toThrow();
  });
});
