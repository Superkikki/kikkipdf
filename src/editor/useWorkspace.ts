import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { APP_NAME } from "../config";
import { newObject, uid, type ImageAsset, type BookmarkDestination } from "../state/model";
import type { BookmarkNavigation } from "../viewer/bookmarkNavigation";
import { documentStore, useDocument } from "../state/store";
import { change } from "../commands/document";
import { setPreference } from "../state/recovery";
import { isTauri, pickFiles, readPath } from "../platform/files";
import { usePrompt } from "../components/Prompt";
import type { Action } from "../components/Toolbar";
import type { Tool } from "../viewer/PageView";
import type { ZoomMode } from "../viewer/Viewer";
import type { ObjectClipboard } from "./objectActions";
import type { WorkspaceModal } from "./types";
import { useRecovery } from "./useRecovery";
import { useDocumentIO } from "./useDocumentIO";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useStartupDocuments } from "./useStartupDocuments";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useDesktopLifecycle } from "./useDesktopLifecycle";
export function useWorkspace() {
  const clipboard = useRef<ObjectClipboard | null>(null);
  const state = useDocument();
  const { document: doc } = state;
  const [active, setActive] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<Tool>("select"),
    [zoom, setZoom] = useState<ZoomMode>("width"),
    [category, setCategory] = useState("編集");
  const [bookmarkNavigation, setBookmarkNavigation] = useState<BookmarkNavigation | null>(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") ?? "light",
  );
  const [error, setError] = useState(""),
    [status, setStatus] = useState("準備完了"),
    [busy, setBusy] = useState<{ label: string; progress: number } | null>(
      null,
    ),
    [modal, setModal] = useState<WorkspaceModal>(null),
    [recent, setRecent] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null),
    busyRef = useRef(false);
  const { ask, dialog } = usePrompt();
  const report = useCallback((s: string) => setError(s), []);
  const page = doc?.pages.find((p) => p.id === active) ?? doc?.pages[0];
  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    if (page && page.id !== active) setActive(page.id);
  }, [page, active]);
  const jump = useCallback((id: string) => {
    setBookmarkNavigation(null);
    setActive(id);
    setSelected(null);
    window.document
      .getElementById(`page-${id}`)
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);
  const jumpBookmark = useCallback((id: string, destination?: BookmarkDestination) => {
    if (!doc || !doc.pages.some((p) => p.id === id)) return;
    if (!destination) { jump(id); return; }
    setActive(id);
    setSelected(null);
    setBookmarkNavigation({ id: uid(), documentId: doc.id, pageId: id, destination });
  }, [doc, jump]);
  const completeBookmarkNavigation = useCallback((id: string) => {
    setBookmarkNavigation((current) => current?.id === id ? null : current);
  }, []);
  function progress(value: number, label?: string) {
    setBusy((prev) =>
      prev ? { label: label ?? prev.label, progress: value } : null,
    );
  }
  async function work(
    label: string,
    job: (signal: AbortSignal) => Promise<void>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    const c = new AbortController();
    controller.current = c;
    setBusy({ label, progress: 0 });
    setStatus(label);
    setError("");
    try {
      await job(c.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        setStatus("キャンセルしました");
      else report(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      controller.current = null;
      setBusy(null);
    }
  }
  const { openFiles, save, mayDiscard } = useDocumentIO({
    ask, work, progress, report, setActive, setSelected, setRecent, setStatus,
  });
  async function addImage(
    bytes?: Uint8Array,
    mime: "image/png" | "image/jpeg" = "image/png",
  ) {
    const p = page;
    if (!p) return;
    const file = bytes
      ? { bytes, name: "signature.png" }
      : (await pickFiles("image"))[0];
    if (!file) return;
    if (!bytes) mime = /\.jpe?g$/i.test(file.name) ? "image/jpeg" : "image/png";
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(file.bytes)], { type: mime }),
    );
    const width = Math.min(240, p.width - 64),
      height = (width * bitmap.height) / bitmap.width;
    bitmap.close();
    const asset: ImageAsset = { id: uid(), bytes: file.bytes, mime };
    const o = {
      ...newObject("image", 32, 32),
      width,
      height,
      imageId: asset.id,
    };
    documentStore.execute(
      change("画像追加", (d) => ({
        ...d,
        images: { ...d.images, [asset.id]: asset },
        pages: d.pages.map((pg) =>
          pg.id === p.id ? { ...pg, objects: [...pg.objects, o] } : pg,
        ),
      })),
    );
    setSelected(o.id);
    setTool("select");
    setCategory("編集");
  }
  const dispatch = useWorkspaceActions({
    doc, page, ask, work, progress, addImage, report, setError, setStatus,
    setActive, setSelected, setModal, openFiles, save, mayDiscard,
  });
  const action = (a: Action) => {
    if (!busyRef.current) void dispatch(a);
  };
  useStartupDocuments({ ask, openFiles, setActive, setRecent, report });
  useRecovery(report);
  useEffect(() => {
    const title = `${state.dirty ? "● " : ""}${doc ? doc.name + " — " : ""}${APP_NAME}`;
    window.document.title = title;
    if (isTauri())
      void getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
  }, [doc, state.dirty]);
  useKeyboardShortcuts({
    openFiles, save, dispatch, selected, page, work, busyRef, clipboard,
    setSelected, setTool, setStatus,
  });
  useDesktopLifecycle({ openFiles, mayDiscard, busyRef, report });
  return {
    ...state,
    active,
    page,
    setActive,
    selected,
    setSelected,
    tool,
    setTool,
    zoom,
    setZoom,
    category,
    setCategory,
    theme,
    setTheme,
    error,
    setError,
    status,
    busy,
    modal,
    setModal,
    recent,
    dialog,
    report,
    jump,
    jumpBookmark,
    bookmarkNavigation,
    completeBookmarkNavigation,
    action,
    cancel: () => controller.current?.abort(),
    openFiles,
    openRecent: (path: string) => {
      void readPath(path)
        .then((file) => openFiles([file]))
        .catch(() =>
          report("最近のPDFを開けません。ファイル選択から開き直してください。"),
        );
    },
    signature: async (bytes: Uint8Array) => {
      setModal(null);
      await setPreference("signature", bytes);
      await addImage(bytes);
    },
  };
}
