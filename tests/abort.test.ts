import { it, expect } from "vitest";
import { withAbort } from "../src/commands/abort";
it("cancels even if a terminated third-party worker never settles", async () => {
  const c = new AbortController();
  const waiting = withAbort(new Promise<void>(() => {}), c.signal);
  c.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
});
