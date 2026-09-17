import { openDB } from "idb";
import type { DocumentModel } from "./model";
const db = () =>
  openDB("kikki-pdf-local", 1, {
    upgrade(d) {
      d.createObjectStore("recovery");
      d.createObjectStore("preferences");
    },
  });
export async function saveRecovery(document: DocumentModel) {
  await (await db()).put("recovery", { document, time: Date.now() }, "active");
}
export async function loadRecovery(): Promise<
  { document: DocumentModel; time: number } | undefined
> {
  return (await db()).get("recovery", "active");
}
export async function clearRecovery() {
  await (await db()).delete("recovery", "active");
}
export async function getPreference<T>(key: string): Promise<T | undefined> {
  return (await db()).get("preferences", key);
}
export async function setPreference(key: string, value: unknown) {
  await (await db()).put("preferences", value, key);
}
