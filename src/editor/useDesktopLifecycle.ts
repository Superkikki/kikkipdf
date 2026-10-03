import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { documentStore } from "../state/store";
import { clearRecovery } from "../state/recovery";
import { isTauri, readPath } from "../platform/files";
import type { useDocumentIO } from "./useDocumentIO";
interface LifecycleOptions extends Pick<ReturnType<typeof useDocumentIO>, "openFiles" | "mayDiscard"> {
  busyRef: RefObject<boolean>;
  report: (error: string) => void;
}
export function useDesktopLifecycle(options: LifecycleOptions) {
  const latest = useRef(options);
  latest.current = options;
  const { busyRef, report } = options;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (documentStore.history?.dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    if (!isTauri())
      return () => window.removeEventListener("beforeunload", before);
    let live = true;
    const offClose = getCurrentWindow().onCloseRequested(async (e) => {
      e.preventDefault();
      if (busyRef.current) {
        report("処理を完了するかキャンセルしてから閉じてください。");
        return;
      }
      if (await latest.current.mayDiscard()) {
        await clearRecovery();
        await getCurrentWindow().destroy();
      }
    });
    const offDrop = getCurrentWindow().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && !busyRef.current) {
        const paths = e.payload.paths.filter((p) => /\.(pdf|kpdf)$/i.test(p));
        void Promise.all(paths.map((path) => readPath(path)))
          .then((files) => latest.current.openFiles(files))
          .catch(() => report("ドロップしたPDFを読み込めません。"));
      }
    });
    void offClose.then((off) => {
      if (!live) off();
    });
    void offDrop.then((off) => {
      if (!live) off();
    });
    return () => {
      live = false;
      window.removeEventListener("beforeunload", before);
      void offClose.then((off) => off());
      void offDrop.then((off) => off());
    };
  }, [report, busyRef]);
}
