import { separateBinaries, type BinaryValue } from "../state/binaryStore";
import type { WorkerMessage, WorkerRequest } from "./worker";

export type Request = WorkerRequest extends infer R
  ? R extends { id: number } ? Omit<R, "id"> : never : never;
interface Job {
  value: BinaryValue<WorkerRequest>;
  binaries: Map<string, Uint8Array>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  progress?: (value: number) => void;
  signal?: AbortSignal;
  cancel: () => void;
}
const CACHE_BYTES = 256 * 1024 * 1024;

/** Serialize PDF jobs to bound parser memory, while retaining immutable input bytes. */
export class PdfWorkerClient {
  private worker?: Worker;
  private serial = 0;
  private active?: Job;
  private readonly queue: Job[] = [];
  private readonly registered = new Map<string, number>();
  constructor(private readonly createWorker: () => Worker) {}

  run<T>(request: Request, progress?: (value: number) => void, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException("キャンセルしました", "AbortError"));
    return new Promise<T>((resolve, reject) => {
      const { value, binaries } = separateBinaries({ ...request, id: ++this.serial } as WorkerRequest);
      const job: Job = {
        value, binaries, progress, signal, resolve: value => resolve(value as T), reject,
        cancel: () => {
          if (this.active === job) {
            this.stopWorker();
            this.finish(undefined, new DOMException("キャンセルしました", "AbortError"));
          } else {
            const index = this.queue.indexOf(job);
            if (index !== -1) this.queue.splice(index, 1);
            signal?.removeEventListener("abort", job.cancel);
            reject(new DOMException("キャンセルしました", "AbortError"));
          }
        },
      };
      signal?.addEventListener("abort", job.cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  reset() {
    this.stopWorker();
    const jobs = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = undefined;
    this.queue.length = 0;
    for (const job of jobs) {
      job.signal?.removeEventListener("abort", job.cancel);
      job.reject(new DOMException("PDF処理を終了しました。", "AbortError"));
    }
  }

  private stopWorker() {
    this.worker?.terminate();
    this.worker = undefined;
    this.registered.clear();
  }

  private pump() {
    if (this.active || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.active = job;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        const instance = this.worker;
        this.worker.onmessage = (event: MessageEvent<{ id: number; progress?: number; result?: unknown; error?: string }>) => {
          const message = event.data;
          if (message.id !== this.active?.value.id) return;
          if (message.progress !== undefined) this.active.progress?.(message.progress);
          else this.finish(message.result, message.error ? Error(message.error) : undefined);
        };
        const failed = () => {
          if (this.worker !== instance) return;
          this.stopWorker();
          this.finish(undefined, Error("PDF処理Workerでエラーが発生しました。"));
        };
        this.worker.onerror = failed;
        this.worker.onmessageerror = failed;
      }
      const fresh: Record<string, Uint8Array<ArrayBuffer>> = {};
      for (const [id, bytes] of job.binaries) {
        if (!this.registered.has(id)) fresh[id] = bytes.slice();
        // Move this binary to the end of the LRU without retaining its UI bytes.
        this.registered.delete(id);
        this.registered.set(id, bytes.length);
      }
      let total = [...this.registered.values()].reduce((n, size) => n + size, 0);
      for (const [id, size] of this.registered) {
        if (total <= CACHE_BYTES) break;
        if (!job.binaries.has(id)) { this.registered.delete(id); total -= size; }
      }
      const message: WorkerMessage = {
        request: job.value, binaries: fresh, retain: [...this.registered.keys()],
      };
      this.worker.postMessage(message, Object.values(fresh).map(bytes => bytes.buffer));
    } catch (error) {
      this.stopWorker();
      this.finish(undefined, error instanceof Error ? error : Error("PDF処理を開始できません。"));
    }
  }

  private finish(value?: unknown, error?: Error) {
    const job = this.active;
    this.active = undefined;
    if (job) {
      job.signal?.removeEventListener("abort", job.cancel);
      if (error) job.reject(error); else job.resolve(value);
    }
    this.pump();
  }
}
