import { useEffect, useRef, type RefObject } from "react";
import { extractImageAsset } from "../images/extract";
import { pasteObject, type ObjectClipboard } from "./objectActions";
import { documentStore } from "../state/store";
import { deleteObject, updateObject } from "../commands/document";
import type { PageModel } from "../state/model";
import type { Action } from "../components/Toolbar";
import type { Tool } from "../viewer/PageView";
import type { Work } from "./types";
import type { useDocumentIO } from "./useDocumentIO";
interface KeyboardOptions extends Pick<ReturnType<typeof useDocumentIO>, "openFiles" | "save"> {
  dispatch: (action: Action) => Promise<void>;
  selected: string | null;
  page: PageModel | undefined;
  work: Work;
  busyRef: RefObject<boolean>;
  clipboard: RefObject<ObjectClipboard | null>;
  setSelected: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setStatus: (status: string) => void;
}
export function useKeyboardShortcuts(options: KeyboardOptions) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const shortcuts = latest.current;
      const { busyRef, clipboard, setSelected, setTool, setStatus } = shortcuts;
      const input =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input,textarea,select,[contenteditable]");
      if (window.document.querySelector("dialog[open]")) return;
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (!input && !busyRef.current && ["c", "x", "v", "d"].includes(k)) {
          const p = shortcuts.page,
            current = p?.objects.find((o) => o.id === shortcuts.selected);
          if (k === "v" && p && clipboard.current) {
            e.preventDefault();
            const pasted = pasteObject(p.id, clipboard.current);
            documentStore.execute(pasted.command);
            setSelected(pasted.id);
            setTool("select");
            return;
          }
          if (
            current &&
            p &&
            !window.getSelection()?.toString() &&
            ["c", "x", "d"].includes(k)
          ) {
            e.preventDefault();
            if (current.kind === "direct-image") {
              const snapshot = documentStore.document!;
              void shortcuts.work("画像データを取り出し中…", async (signal) => {
                const image = await extractImageAsset(snapshot, current, signal);
                const live = documentStore.document;
                if (signal.aborted || live?.id !== snapshot.id || live.pages.find(page => page.id === p.id)?.objects.find(o => o.id === current.id) !== current) return;
                const data = { object: current, image };
                if (k === "d") {
                  const pasted = pasteObject(p.id, data);
                  documentStore.execute(pasted.command); setSelected(pasted.id); setTool("select");
                  setStatus("既存画像を複製しました");
                } else {
                  clipboard.current = data;
                  if (k === "x") { documentStore.execute(deleteObject(p.id, current.id)); setSelected(null); }
                  setStatus(k === "x" ? "既存画像を切り取りました" : "既存画像をコピーしました");
                }
              });
              return;
            }
            const data = {
              object: current,
              font: current.fontId
                ? documentStore.document?.fonts?.[current.fontId]
                : undefined,
              image: current.imageId
                ? documentStore.document?.images[current.imageId]
                : undefined,
            };
            if (k === "d") {
              const pasted = pasteObject(p.id, data);
              documentStore.execute(pasted.command);
              setSelected(pasted.id);
            } else {
              clipboard.current = data;
              setStatus("オブジェクトをコピーしました");
              if (k === "x") {
                documentStore.execute(deleteObject(p.id, current.id));
                setSelected(null);
              }
            }
            return;
          }
        }
        if (["o", "s", "z", "y", "p"].includes(k)) {
          if (input && (k === "z" || k === "y")) return;
          e.preventDefault();
          if (busyRef.current) return;
          if (k === "p") void shortcuts.dispatch("print");
          if (k === "o") void shortcuts.openFiles();
          if (k === "s") void shortcuts.save(e.shiftKey);
          if (k === "z") {
            if (e.shiftKey) documentStore.redo();
            else documentStore.undo();
          }
          if (k === "y") documentStore.redo();
        }
      } else if (
        !input &&
        !busyRef.current &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
        shortcuts.selected &&
        shortcuts.page
      ) {
        const p = shortcuts.page,
          object = p.objects.find((o) => o.id === shortcuts.selected);
        if (object) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1,
            x =
              e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
            y = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0,
            r = (p.rotation * Math.PI) / 180;
          documentStore.execute(
            updateObject(p.id, object.id, {
              x: Math.max(
                0,
                object.x + Math.round(Math.cos(r) * x + Math.sin(r) * y),
              ),
              y: Math.max(
                0,
                object.y + Math.round(-Math.sin(r) * x + Math.cos(r) * y),
              ),
            }),
          );
        }
      } else if (
        e.key === "Delete" &&
        !input &&
        shortcuts.selected &&
        shortcuts.page
      ) {
        documentStore.execute(
          deleteObject(shortcuts.page.id, shortcuts.selected),
        );
        setSelected(null);
      } else if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}
