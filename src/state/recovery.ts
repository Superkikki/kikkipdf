import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocumentModel } from "./model";
import { separateBinaries, restoreBinaries, type BinaryValue } from "./binaryStore";

interface LegacyRecovery { document: DocumentModel; time: number; version?: 1 }
interface RecoverySnapshot {
  version: 2;
  document: BinaryValue<DocumentModel>;
  binaryIds: string[];
  time: number;
}
interface LocalDatabase extends DBSchema {
  recovery: { key: string; value: LegacyRecovery | RecoverySnapshot };
  binaries: { key: string; value: Uint8Array };
  preferences: { key: string; value: unknown };
}
let database: Promise<IDBPDatabase<LocalDatabase>> | undefined;
const db = () => database ??= openDB<LocalDatabase>("kikki-pdf-local", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("recovery");
        d.createObjectStore("preferences");
      }
      if (oldVersion < 2) d.createObjectStore("binaries");
    },
    blocking() {
      void database?.then(connection => connection.close());
      database = undefined;
    },
    terminated() { database = undefined; },
  }).catch(error => { database = undefined; throw error; });
// Order writes at invocation time, including while IndexedDB is still opening.
// A pending autosave must never recreate a record after it has been cleared.
let writes: Promise<unknown> = Promise.resolve();
function write<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => {});
  return result;
}
export function saveRecovery(document: DocumentModel) {
  return write(async () => {
    const { value, binaries } = separateBinaries(document);
    const tx = (await db()).transaction(["recovery", "binaries"], "readwrite");
    void tx.done.catch(() => {});
    const operations: Promise<unknown>[] = [];
    try {
      const assets = tx.objectStore("binaries");
      const existing = new Set(await assets.getAllKeys());
      // Store each immutable binary once; subsequent autosaves only update edits.
      for (const [id, bytes] of binaries) if (!existing.has(id)) operations.push(assets.put(bytes, id));
      for (const id of existing) if (!binaries.has(id)) operations.push(assets.delete(id));
      operations.push(tx.objectStore("recovery").put({
        version: 2, document: value, binaryIds: [...binaries.keys()], time: Date.now(),
      }, "active"));
      await Promise.all([...operations, tx.done]);
    } catch (error) {
      try { tx.abort(); } catch { /* IndexedDB may already have aborted. */ }
      await Promise.allSettled([...operations, tx.done]);
      throw error;
    }
  });
}
export async function loadRecovery(): Promise<
  { document: DocumentModel; time: number } | undefined
> {
  await writes;
  const tx = (await db()).transaction(["recovery", "binaries"]);
  const record = await tx.objectStore("recovery").get("active");
  if (!record || record.version !== 2) return record;
  const binaries = new Map(await Promise.all(record.binaryIds.map(async id => {
    const bytes = await tx.objectStore("binaries").get(id);
    if (!bytes) throw Error("復旧データのバイナリが見つかりません。");
    return [id, bytes] as const;
  })));
  await tx.done;
  const document = restoreBinaries<DocumentModel>(record.document, id => {
    const bytes = binaries.get(id);
    if (!bytes) throw Error("復旧データのバイナリが見つかりません。");
    return bytes;
  });
  return { document, time: record.time };
}
export function clearRecovery() {
  return write(async () => {
    const tx = (await db()).transaction(["recovery", "binaries"], "readwrite");
    await Promise.all([
      tx.objectStore("recovery").delete("active"),
      tx.objectStore("binaries").clear(),
      tx.done,
    ]);
  });
}
export async function getPreference<T>(key: string): Promise<T | undefined> {
  return (await db()).get("preferences", key) as Promise<T | undefined>;
}
export async function setPreference(key: string, value: unknown) {
  await (await db()).put("preferences", value, key);
}
