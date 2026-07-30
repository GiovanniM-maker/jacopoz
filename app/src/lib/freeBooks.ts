import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * "Is this book free to read here?" resolved by id, for any cover on screen.
 *
 * Covers are rendered from three different row shapes (book_card, book_reco,
 * feed_item), so widening those to carry free_read_url would have meant
 * rewriting the whole read path. Instead every cover asks by id, and this module
 * collects the ids that appear within the same tick and resolves them in ONE
 * round trip, caching the answer for the session. Rendering a hundred covers
 * costs a single query, not a hundred.
 */
const cache = new Map<string, boolean>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending = new Set();
  if (ids.length === 0) return;
  try {
    const { data, error } = await supabase.rpc("get_free_flags", { p_ids: ids });
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; is_free: boolean }[]) {
      cache.set(row.id, row.is_free);
    }
    // Ids the server didn't return simply aren't free (or no longer exist);
    // record them so we never ask again.
    for (const id of ids) if (!cache.has(id)) cache.set(id, false);
    notify();
  } catch {
    // Leave them unresolved: the badge stays hidden rather than showing a guess.
  }
}

function request(id: string) {
  if (cache.has(id) || pending.has(id)) return;
  pending.add(id);
  if (!timer) timer = setTimeout(flush, 60);
}

/** True when the book can be read free in-app; undefined until known. */
export function useIsFree(bookId?: string | null): boolean | undefined {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!bookId) return;
    if (cache.has(bookId)) return;
    request(bookId);
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [bookId]);

  return bookId ? cache.get(bookId) : undefined;
}
