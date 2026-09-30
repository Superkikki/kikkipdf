import type { TextLayout, TextStyle } from "./layout";
let worker: Worker | undefined;
let serial = 0;
const pending = new Map<
  number,
  { resolve: (result: TextLayout) => void; reject: (error: Error) => void }
>();
const inflight = new Map<string, Promise<TextLayout>>();
export function requestTextLayout(style: TextStyle): Promise<TextLayout> {
  const key = JSON.stringify(style);
  const existing = inflight.get(key);
  if (existing) return existing;
  worker ??= createWorker();
  const id = ++serial;
  const promise = new Promise<TextLayout>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, style });
  });
  inflight.set(key, promise);
  promise.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
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
    for (const entry of pending.values())
      entry.reject(Error("文字レイアウトWorkerでエラーが発生しました。"));
    pending.clear();
    instance.terminate();
    worker = undefined;
  };
  return instance;
}
