import { invoke } from "@tauri-apps/api/core";

/** Raw IPC: little-endian UTF-8 password length, password, then PDF bytes. */
export async function transformPdf(
  operation: "encrypt" | "decrypt",
  bytes: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(password);
  const offset = 4 + encoded.length;
  const payload = new Uint8Array(offset + bytes.length);
  new DataView(payload.buffer).setUint32(0, encoded.length, true);
  payload.set(encoded, 4);
  encoded.fill(0);
  payload.set(bytes, offset);
  try {
    return new Uint8Array(await invoke<ArrayBuffer>(`${operation}_pdf`, payload));
  } finally {
    payload.fill(0, 4, offset);
  }
}
