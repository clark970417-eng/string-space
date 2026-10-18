import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Piece } from "../music/model";
type StoredPiece = { id: string; updatedAt: number; [key: string]: unknown };
interface LibraryDB extends DBSchema {
  pieces: { key: string; value: Piece | StoredPiece };
  meta: { key: string; value: string };
}
let connection: Promise<IDBPDatabase<LibraryDB>> | undefined;
const db = () =>
  (connection ??= openDB<LibraryDB>("string-space-library", 1, {
    upgrade(db) {
      db.createObjectStore("pieces", { keyPath: "id" });
      db.createObjectStore("meta");
    },
  }));
// Preserve invocation order: an older autosave must never finish after a delete.
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation, operation);
  mutations = result.catch(() => {});
  return result;
}
// Some WebKit contexts reject Blob/File in IndexedDB. Persist bytes instead,
// while preserving existing records and restoring Blob at the storage boundary.
const blobBytes = new WeakMap<Blob, Promise<ArrayBuffer>>();
async function encode(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    let bytes = blobBytes.get(value);
    if (!bytes) {
      bytes =
        typeof value.arrayBuffer === "function"
          ? value.arrayBuffer()
          : new Promise<ArrayBuffer>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result as ArrayBuffer);
              r.onerror = () => reject(r.error);
              r.readAsArrayBuffer(value);
            });
      blobBytes.set(value, bytes);
    }
    return { __stringSpaceBlob: 1, bytes: await bytes, type: value.type };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])),
    );
  return value;
}
function decode(value: unknown): unknown {
  if (value instanceof Blob || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (
      v.__stringSpaceBlob === 1 &&
      Object.prototype.toString.call(v.bytes) === "[object ArrayBuffer]"
    )
      return new Blob([v.bytes as ArrayBuffer], { type: String(v.type) });
    return Object.fromEntries(Object.entries(v).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
export const library = {
  async all() {
    await mutations;
    return (await (await db()).getAll("pieces"))
      .map((v) => decode(v) as Piece)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  save(piece: Piece) {
    return mutate(async () => {
      await (await db()).put("pieces", (await encode(piece)) as StoredPiece);
    });
  },
  remove(id: string) {
    return mutate(async () => {
      await (await db()).delete("pieces", id);
    });
  },
  async getMeta(key: string) {
    return (await db()).get("meta", key);
  },
  setMeta(key: string, value: string) {
    return mutate(async () => {
      await (await db()).put("meta", value, key);
    });
  },
};
