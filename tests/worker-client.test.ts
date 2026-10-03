import { expect, it, vi } from "vitest";
import { PdfWorkerClient } from "../src/export/workerClient";
import type { WorkerMessage } from "../src/export/worker";
import { emptyDocument } from "../src/state/model";

class FakeWorker {
  messages: WorkerMessage[] = [];
  onmessage?: (event: { data: { id: number; result?: unknown; progress?: number; error?: string } }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage(value: WorkerMessage, transfer: Transferable[]) {
    this.messages.push(structuredClone(value, { transfer }));
  }
  reply(result: unknown, index = this.messages.length - 1) {
    this.onmessage?.({ data: { id: this.messages[index].request.id, result } });
  }
}
function setup() {
  const workers: FakeWorker[] = [];
  const client = new PdfWorkerClient(() => {
    const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker;
  });
  const bytes = new Uint8Array([1, 2, 255]);
  const model = emptyDocument(); model.sources.s = { id: "s", name: "pdf", bytes };
  return { client, workers, bytes, model };
}

it("reuses a Worker and its input binaries without detaching UI or history bytes", async () => {
  const { client, workers, bytes, model } = setup();
  const first = client.run({ type: "export", model });
  expect(Object.values(workers[0].messages[0].binaries)).toEqual([bytes]);
  expect(bytes.byteLength).toBe(3);
  workers[0].reply(new Uint8Array([9])); await first;
  const second = client.run({ type: "export", model: { ...model, name: "renamed.pdf" } });
  expect(workers).toHaveLength(1);
  expect(workers[0].messages[1].binaries).toEqual({});
  expect(workers[0].messages[1].request).toMatchObject({ model: { sources: { s: { bytes: { $binary: expect.any(String) } } } } });
  workers[0].reply(new Uint8Array([8])); await second;
  expect(workers[0].terminate).not.toHaveBeenCalled();
  expect(bytes).toEqual(new Uint8Array([1, 2, 255]));
  client.reset();
});

it("serializes jobs and routes progress only to the active request", async () => {
  const { client, workers, model } = setup(), progress = vi.fn();
  const first = client.run({ type: "export", model }, progress);
  const second = client.run({ type: "forms", model });
  expect(workers[0].messages).toHaveLength(1);
  workers[0].onmessage?.({ data: { id: -1, progress: 0.5 } });
  expect(progress).not.toHaveBeenCalled();
  workers[0].onmessage?.({ data: { id: workers[0].messages[0].request.id, progress: 0.5 } });
  expect(progress).toHaveBeenCalledWith(0.5);
  workers[0].reply("exported"); await expect(first).resolves.toBe("exported");
  expect(workers[0].messages).toHaveLength(2);
  workers[0].reply([]); await expect(second).resolves.toEqual([]);
  client.reset();
});

it("cancels a queued job without interrupting active work", async () => {
  const { client, workers, model } = setup(), controller = new AbortController();
  const first = client.run({ type: "export", model });
  const second = client.run({ type: "export", model }, undefined, controller.signal);
  controller.abort(); await expect(second).rejects.toMatchObject({ name: "AbortError" });
  expect(workers[0].terminate).not.toHaveBeenCalled();
  workers[0].reply("done"); await first;
  expect(workers[0].messages).toHaveLength(1);
  client.reset();
});

it("terminates active work on cancellation and registers bytes again for queued work", async () => {
  const { client, workers, model } = setup(), controller = new AbortController();
  const first = client.run({ type: "export", model }, undefined, controller.signal);
  const second = client.run({ type: "export", model });
  const staleFailure = workers[0].onerror;
  controller.abort(); await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(2);
  expect(Object.keys(workers[1].messages[0].binaries)).toHaveLength(1);
  staleFailure?.();
  expect(workers[1].terminate).not.toHaveBeenCalled();
  workers[1].reply("done"); await expect(second).resolves.toBe("done");
  client.reset();
});

it("recovers after a Worker crash without rejecting queued requests", async () => {
  const { client, workers, model } = setup();
  const first = client.run({ type: "export", model });
  const second = client.run({ type: "export", model });
  workers[0].onerror?.();
  await expect(first).rejects.toThrow("Worker");
  expect(workers).toHaveLength(2);
  workers[1].reply("done"); await second;
  client.reset();
});

it("releases all queued work and cached inputs when the document is replaced", async () => {
  const { client, workers, model } = setup();
  const first = client.run({ type: "export", model });
  const second = client.run({ type: "forms", model });
  client.reset();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});
