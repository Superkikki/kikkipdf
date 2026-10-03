import { beforeEach, expect, it, vi } from "vitest";
import { History } from "../src/commands/history";
import { rotatePage } from "../src/commands/document";
import { blankPage, emptyDocument } from "../src/state/model";
import { trackRecovery } from "../src/state/recoveryTracker";
import { clearRecovery, saveRecovery } from "../src/state/recovery";

vi.mock("../src/state/recovery", () => ({
  clearRecovery: vi.fn().mockResolvedValue(undefined),
  saveRecovery: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => { vi.clearAllMocks(); });

function setup() {
  const document = emptyDocument();
  document.pages = [blankPage()];
  const listeners = new Set<() => void>();
  const store = {
    history: new History(document),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const report = vi.fn();
  const tracker = trackRecovery(store, report);
  const emit = () => { listeners.forEach(listener => listener()); };
  const edit = () => { store.history.execute(rotatePage(document.pages[0].id)); emit(); };
  return { store, tracker, report, emit, edit };
}

it("preserves startup recovery until a dirty document becomes clean", async () => {
  const { tracker, edit, store, emit } = setup();
  await tracker.save();
  emit();
  expect(clearRecovery).not.toHaveBeenCalled();
  expect(saveRecovery).not.toHaveBeenCalled();
  edit();
  await tracker.save();
  store.history.undo(); emit();
  expect(store.history.dirty).toBe(false);
  expect(clearRecovery).toHaveBeenCalledOnce();
  tracker.dispose();
});

it("skips unchanged revisions and saves them again after undo to clean and redo", async () => {
  const { tracker, edit, store, emit } = setup();
  edit();
  await tracker.save(); await tracker.save();
  expect(saveRecovery).toHaveBeenCalledOnce();
  store.history.undo(); emit();
  store.history.redo(); emit();
  await tracker.save();
  expect(saveRecovery).toHaveBeenCalledTimes(2);
  edit(); await tracker.save();
  expect(saveRecovery).toHaveBeenCalledTimes(3);
  tracker.dispose();
});

it("does not clear recovery when an older revision finishes saving during edits", async () => {
  const { tracker, edit, store, emit } = setup();
  const token = store.history.current.token;
  edit(); await tracker.save();
  store.history.markSaved(token); emit();
  expect(store.history.dirty).toBe(true);
  expect(clearRecovery).not.toHaveBeenCalled();
  tracker.dispose();
});

it("retries failed autosaves", async () => {
  const { tracker, report, edit } = setup();
  vi.mocked(saveRecovery).mockRejectedValueOnce(Error("quota"));
  edit();
  await tracker.save(); await tracker.save();
  expect(report).toHaveBeenCalledOnce();
  expect(saveRecovery).toHaveBeenCalledTimes(2);
  tracker.dispose();
});

it("discards the old recovery when replacing a dirty document with another dirty document", async () => {
  const { tracker, edit, store, emit } = setup();
  edit(); await tracker.save();
  const next = emptyDocument("new.pdf"); next.pages = [blankPage()];
  store.history = new History(next); store.history.markRecovered(); emit();
  expect(clearRecovery).toHaveBeenCalledOnce();
  await tracker.save();
  expect(saveRecovery).toHaveBeenLastCalledWith(next);
  tracker.dispose();
});

it("does not treat an autosave finishing after undo and redo as current recovery", async () => {
  const { tracker, edit, store, emit } = setup();
  let finish!: () => void;
  vi.mocked(saveRecovery).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  edit();
  const first = tracker.save();
  await tracker.save();
  expect(saveRecovery).toHaveBeenCalledOnce();
  store.history.undo(); emit();
  store.history.redo(); emit();
  finish(); await first;
  await tracker.save();
  expect(saveRecovery).toHaveBeenCalledTimes(2);
  tracker.dispose();
});
