import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { transformPdf } from "../src/platform/pdfSecurity";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

it("uses a raw binary envelope with a UTF-8 password and leaves input bytes intact", async () => {
  const bytes = new Uint8Array([0, 255, 1, 127]), password = "日本語🔑password";
  let payload!: Uint8Array;
  let offset = 0;
  vi.mocked(invoke).mockImplementationOnce(async (command, args) => {
    expect(command).toBe("encrypt_pdf");
    expect(args).toBeInstanceOf(Uint8Array);
    payload = args as Uint8Array;
    offset = 4 + new DataView(payload.buffer).getUint32(0, true);
    expect(new TextDecoder().decode(payload.subarray(4, offset))).toBe(password);
    expect(payload.subarray(offset)).toEqual(bytes);
    return new Uint8Array([9, 8]).buffer;
  });
  expect(await transformPdf("encrypt", bytes, password)).toEqual(new Uint8Array([9, 8]));
  expect(payload.subarray(4, offset).every(byte => byte === 0)).toBe(true);
  expect(bytes).toEqual(new Uint8Array([0, 255, 1, 127]));
});

it("clears the password envelope even when native processing fails", async () => {
  let payload!: Uint8Array;
  vi.mocked(invoke).mockImplementationOnce(async (_command, args) => {
    payload = args as Uint8Array;
    throw Error("wrong password");
  });
  await expect(transformPdf("decrypt", new Uint8Array([1]), "secret")).rejects.toThrow("wrong password");
  expect([...payload.subarray(4, -1)]).toEqual([0, 0, 0, 0, 0, 0]);
});
