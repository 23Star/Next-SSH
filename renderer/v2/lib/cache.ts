// Tiny in-memory cache shared by hooks.
//
// The goal is stale-while-revalidate: pages re-mount and hosts switch all the
// time in this shell, and we don't want a white flash while the new fetch is
// in flight. Hooks seed from here on mount and write back when a fresh value
// lands. Nothing is persisted across reloads — just session-local.

interface Entry<T> {
  data: T;
  ts: number;
}

const store = new Map<string, Entry<unknown>>();

export function readCache<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

export function writeCache<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() });
}

export function clearCache(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}
