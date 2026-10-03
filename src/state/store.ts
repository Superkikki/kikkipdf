import { useSyncExternalStore } from "react";
import { History, type Command } from "../commands/history";
import type { DocumentModel } from "./model";
import { resetTextLayout } from "../text/client";
import { resetExportWorker } from "../export/client";
let history: History | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export const documentStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  get history() {
    return history;
  },
  get document() {
    return history?.current.document ?? null;
  },
  load(document: DocumentModel, recovered = false) {
    resetTextLayout();
    resetExportWorker();
    history = new History(document);
    if (recovered) history.markRecovered();
    emit();
  },
  execute(command: Command) {
    history?.execute(command);
    emit();
  },
  undo() {
    history?.undo();
    emit();
  },
  redo() {
    history?.redo();
    emit();
  },
  saved(token: number, name: string, path?: string) {
    history?.markSaved(token);
    history?.rename(name, path);
    emit();
  },
  clear() {
    resetTextLayout();
    resetExportWorker();
    history = null;
    emit();
  },
};
export function useDocument() {
  useSyncExternalStore(
    documentStore.subscribe,
    () => version,
  );
  return {
    document: documentStore.document,
    dirty: history?.dirty ?? false,
    canUndo: history?.canUndo ?? false,
    canRedo: history?.canRedo ?? false,
  };
}
