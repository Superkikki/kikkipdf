import { expect, it } from "vitest";
import { blankPage, emptyDocument, newObject } from "../src/state/model";
import { History } from "../src/commands/history";
import { updateObject } from "../src/commands/document";
import { clearOcr, ocrRows, reviewOcr } from "../src/ocr/review";
import { openProject, saveProject } from "../src/state/project";
it("corrects OCR independently of source content and keeps review state undoable and portable", async () => {
  const model = emptyDocument();
  model.pages = [blankPage(), blankPage()];
  const text = { ...newObject("text", 10, 20), text: "Visible original" };
  const recognized = {
    ...newObject("ocr", 10, 20),
    text: "Recognizcd",
    ocrConfidence: 74,
    opacity: 0,
  };
  model.pages[0].objects = [text, recognized];
  model.pages[1].objects = [
    { ...newObject("ocr", 20, 30), text: "Other page", opacity: 0 },
  ];
  const history = new History(model);
  history.execute(reviewOcr(ocrRows(model, model.pages[0].id), true));
  expect(history.current.document.pages[0].objects[1].ocrReviewed).toBe(true);
  history.execute(
    updateObject(model.pages[0].id, recognized.id, { text: "Recognized" }),
  );
  expect(history.current.document.pages[0].objects[1].ocrReviewed).toBe(false);
  history.undo();
  expect(history.current.document.pages[0].objects[1].text).toBe("Recognizcd");
  history.redo();
  history.execute(
    reviewOcr(ocrRows(history.current.document, model.pages[0].id), true),
  );
  const reopened = await openProject(
    await saveProject(history.current.document),
  );
  expect(reopened.pages[0].objects[1]).toMatchObject({
    text: "Recognized",
    opacity: 0,
    ocrConfidence: 74,
    ocrReviewed: true,
  });
  history.execute(clearOcr([model.pages[0].id]));
  expect(history.current.document.pages[0].objects).toEqual([text]);
  expect(ocrRows(history.current.document)).toHaveLength(1);
  history.undo();
  expect(ocrRows(history.current.document)).toHaveLength(2);
});
