/** Immutable byte arrays have stable identities across edits and undo revisions. */
const identities = new WeakMap<Uint8Array, string>();
export interface BinaryReference { $binary: string }
export type BinaryValue<T> = T extends Uint8Array ? BinaryReference
  : T extends object ? { [K in keyof T]: BinaryValue<T[K]> } : T;

export function separateBinaries<T>(input: T): {
  value: BinaryValue<T>;
  binaries: Map<string, Uint8Array>;
} {
  const binaries = new Map<string, Uint8Array>();
  function visit(value: unknown): unknown {
    if (value instanceof Uint8Array) {
      let id = identities.get(value);
      if (!id) { id = crypto.randomUUID(); identities.set(value, id); }
      binaries.set(id, value);
      return { $binary: id };
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  }
  return { value: visit(input) as BinaryValue<T>, binaries };
}

export function restoreBinaries<T>(input: BinaryValue<T>, get: (id: string) => Uint8Array): T {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      if ("$binary" in value && typeof value.$binary === "string" && Object.keys(value).length === 1) {
        const bytes = get(value.$binary);
        identities.set(bytes, value.$binary);
        return bytes;
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    }
    return value;
  }
  return visit(input) as T;
}

/** Worker cache; callers explicitly retain only the binaries needed by the next job. */
export class BinaryStore {
  private readonly values = new Map<string, Uint8Array>();
  register(entries: Record<string, Uint8Array>) {
    for (const [id, bytes] of Object.entries(entries)) this.values.set(id, bytes);
  }
  get = (id: string): Uint8Array => {
    const value = this.values.get(id);
    if (!value) throw Error("参照元のバイナリが見つかりません。");
    return value;
  };
  retain(ids: Set<string>) {
    for (const id of this.values.keys()) if (!ids.has(id)) this.values.delete(id);
  }
  owns(buffer: ArrayBufferLike) {
    return [...this.values.values()].some(bytes => bytes.buffer === buffer);
  }
}
