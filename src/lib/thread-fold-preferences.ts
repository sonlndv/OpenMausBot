import { useEffect, useState } from "react";

export const UNFOLDED_THREADS_KEY = "omb-unfolded-threads";

export function browserSidebar(): boolean {
  return typeof window !== "undefined" && !window.ogb;
}

function preferenceKey(): string {
  return browserSidebar() ? "omb-folded-threads" : UNFOLDED_THREADS_KEY;
}

const LIMIT = 200;
const NONE: ReadonlySet<string> = new Set();
let cache: { raw: string | null; ids: ReadonlySet<string> } | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function botsWithNondefaultFold(): ReadonlySet<string> {
  let raw: string | null;
  try {
    const store = storage();
    if (!store) return cache?.ids ?? NONE;
    raw = store.getItem(preferenceKey());
  } catch {
    return cache?.ids ?? NONE;
  }
  if (cache && cache.raw === raw) return cache.ids;
  let ids: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string");
  } catch {
  }
  cache = { raw, ids: new Set(ids) };
  return cache.ids;
}

export function setThreadsUnfolded(botId: string, unfolded: boolean): void {
  const ids = [...botsWithNondefaultFold()].filter((id) => id !== botId);
  if (unfolded !== browserSidebar()) ids.push(botId);
  const kept = ids.slice(-LIMIT);
  const raw = JSON.stringify(kept);
  cache = { raw, ids: new Set(kept) };
  try {
    storage()?.setItem(preferenceKey(), raw);
  } catch {
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function threadsUnfolded(botId: string): boolean {
  const defaultOpen = browserSidebar();
  return botsWithNondefaultFold().has(botId) ? !defaultOpen : defaultOpen;
}

export function useThreadsUnfolded(botId: string): boolean {
  const [unfolded, setUnfolded] = useState(() => threadsUnfolded(botId));
  useEffect(() => {
    const read = () => setUnfolded(threadsUnfolded(botId));
    read();
    return subscribe(read);
  }, [botId]);
  return unfolded;
}
