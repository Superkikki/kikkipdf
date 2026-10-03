import type { History } from "../commands/history";
import { clearRecovery, saveRecovery } from "./recovery";

interface RecoveryStore {
  readonly history: History | null;
  subscribe(listener: () => void): () => void;
}

/** Observe every store transition, even when React batches several revisions. */
export function trackRecovery(store: RecoveryStore, report: (error: string) => void) {
  let previousHistory = store.history;
  let dirty = previousHistory?.dirty ?? false;
  let generation = 0;
  let saved: { history: History; document: History["current"]["document"] } | undefined;
  let pending: typeof saved;
  const unsubscribe = store.subscribe(() => {
    const nextHistory = store.history;
    const nextDirty = nextHistory?.dirty ?? false;
    const replaced = nextHistory !== previousHistory;
    if (replaced || (dirty && !nextDirty)) {
      generation++;
      saved = pending = undefined;
    }
    if (dirty && (!nextDirty || replaced)) {
      void clearRecovery().catch(() => report("自動復旧データを削除できません。"));
    }
    previousHistory = nextHistory;
    dirty = nextDirty;
  });
  return {
    async save() {
      const history = store.history;
      if (!history?.dirty) return;
      const document = history.current.document;
      if ([saved, pending].some(entry => entry?.history === history && entry.document === document)) return;
      const snapshot = { history, document }, version = generation;
      pending = snapshot;
      try {
        await saveRecovery(document);
        if (generation === version) saved = snapshot;
      } catch {
        report("自動復旧データを保存できません。空き容量を確認してください。");
      } finally {
        if (pending === snapshot) pending = undefined;
      }
    },
    dispose: unsubscribe,
  };
}
