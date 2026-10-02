import type { TextLayout, TextStyle } from "./layout";
import type { FontAsset } from "../state/model";
let worker: Worker | undefined;
const registered = new Map<string, number>();
let serial = 0;
const pending = new Map<
  number,
  { resolve: (result: TextLayout) => void; reject: (error: Error) => void }
>();
const inflight = new Map<string, Promise<TextLayout>>();
export function requestTextLayout(
  style: TextStyle,
  asset?: FontAsset,
): Promise<TextLayout> {
  if (
    asset &&
    !registered.has(asset.id) &&
    (registered.size >= 32 ||
      [...registered.values()].reduce((n, length) => n + length, 0) +
        asset.bytes.length >
        128 * 1024 * 1024)
  )
    resetTextLayout();
  const key = JSON.stringify(style);
  const existing = inflight.get(key);
  if (existing) return existing;
  worker ??= createWorker();
  const id = ++serial;
  const promise = new Promise<TextLayout>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const font = asset && !registered.has(asset.id) ? asset : undefined;
    if (font) registered.set(font.id, font.bytes.length);
    worker!.postMessage({ id, style, font });
  });
  inflight.set(key, promise);
  const clear = () => {
    if (inflight.get(key) === promise) inflight.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}
function createWorker() {
  const instance = new Worker(new URL("./layout.worker.ts", import.meta.url), {
    type: "module",
  });
  instance.onmessage = (
    event: MessageEvent<{ id: number; result: TextLayout; error?: string }>,
  ) => {
    const { id, result, error } = event.data;
    const entry = pending.get(id);
    pending.delete(id);
    if (error) entry?.reject(Error(error));
    else entry?.resolve(result);
  };
  instance.onerror = () => {
    resetTextLayout();
  };
  return instance;
}
export function resetTextLayout() {
  for (const entry of pending.values())
    entry.reject(Error("文字レイアウト処理を終了しました。"));
  pending.clear();
  inflight.clear();
  registered.clear();
  worker?.terminate();
  worker = undefined;
}
