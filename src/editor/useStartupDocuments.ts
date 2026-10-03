import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { documentStore } from "../state/store";
import { clearRecovery, loadRecovery } from "../state/recovery";
import { isTauri, readPath, recentPaths } from "../platform/files";
import type { Ask } from "./types";
import type { useDocumentIO } from "./useDocumentIO";
interface StartupOptions {
  ask: Ask;
  openFiles: ReturnType<typeof useDocumentIO>["openFiles"];
  setActive: (id: string) => void;
  setRecent: (paths: string[]) => void;
  report: (error: string) => void;
}
export function useStartupDocuments({ ask, openFiles, setActive, setRecent, report }: StartupOptions) {
  const init = useRef(false);
  const latestOpen = useRef(openFiles);
  latestOpen.current = openFiles;
  useEffect(() => {
    if (init.current) return;
    init.current = true;
    void recentPaths()
      .then(setRecent)
      .catch(() => {});
    void loadRecovery()
      .then(async (recovery) => {
        if (recovery) {
          const r = await ask({
            title: "前回の編集を復元",
            message: `${recovery.document.name} の未保存データがあります（${new Date(recovery.time).toLocaleString()}）。`,
            confirm: "復元",
          });
          if (r) {
            documentStore.load(recovery.document, true);
            setActive(recovery.document.pages[0].id);
            return;
          } else await clearRecovery();
        }
        if (isTauri()) {
          const paths = await invoke<string[]>("startup_documents");
          if (paths.length)
            await latestOpen.current(
              await Promise.all(paths.map((path) => readPath(path))),
            );
        }
      })
      .catch(() => report("復旧データを読み込めませんでした。"));
  }, [ask, report, setRecent, setActive]);
}
