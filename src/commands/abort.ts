/** Reject promptly even when a third-party worker leaves its promise pending after terminate(). */
export function withAbort<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () =>
      reject(new DOMException("キャンセルしました", "AbortError"));
    task
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
