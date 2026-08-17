import { supabase } from "@/lib/supabase";
import type { UUID } from "@/types/database";

export interface ReadInfo {
  readable: boolean;
  gutenberg_id: number | null;
}

/**
 * Availability of a free (public-domain) read for a book. The edge function
 * lazily matches the book to Project Gutenberg on first ask and caches the
 * result — so this also repairs classic author names.
 */
export async function getReadInfo(bookId: UUID): Promise<ReadInfo> {
  const { data, error } = await supabase.functions.invoke("read", {
    body: { book_id: bookId },
  });
  if (error || !data) return { readable: false, gutenberg_id: null };
  return { readable: !!data.readable, gutenberg_id: data.gutenberg_id ?? null };
}

/** The cleaned full text of a public-domain book (proxied, boilerplate stripped). */
export async function getBookText(gutenbergId: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke("read", {
    body: { gutenberg_id: gutenbergId },
  });
  if (error || !data?.text) throw new Error("Testo non disponibile");
  return data.text as string;
}

/** Persist reading position; ≥90% marks the book read (strongest signal). */
export async function saveReadProgress(bookId: UUID, percent: number): Promise<void> {
  try {
    await supabase.rpc("save_read_progress", { p_book_id: bookId, p_percent: Math.round(percent) });
  } catch {
    // best-effort
  }
}

export interface ReadState {
  percent: number;
  bookmark: number | null;
}

export async function getReadProgress(bookId: UUID): Promise<ReadState> {
  // Se questa fallisce in silenzio il lettore riparte da pagina uno senza
  // sapere perché: il segnaposto non è un ornamento, è la ragione per cui
  // riapre il libro.
  const { data, error } = await supabase
    .from("book_read_progress")
    .select("percent, bookmark_percent")
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return {
    percent: data ? Number(data.percent) : 0,
    bookmark: data?.bookmark_percent != null ? Number(data.bookmark_percent) : null,
  };
}

/** Drop (or clear, with null) a deliberate bookmark at a scroll position. */
export async function saveBookmark(bookId: UUID, percent: number | null): Promise<void> {
  try {
    await supabase.rpc("save_bookmark", {
      p_book_id: bookId,
      p_percent: percent == null ? null : Math.round(percent),
    });
  } catch {
    // best-effort
  }
}

// Qui stava `amazonUrl`, il link di ripiego verso amazon.it. Rimosso il
// 15 agosto 2026 insieme al resto della superficie Amazon: il tag di
// affiliazione salvato è `jacopoz-20`, un tag .com, e i link andavano su
// amazon.it — marketplace diverso, tag ignorato, nessuna conversione mai
// attribuita. Mandare i lettori fuori dall'app senza guadagnarci nulla non
// vale il posto che occupava nella scheda libro.
//
// Nulla di tutto questo riguarda la lettura gratuita: `getReadInfo`,
// `getBookText`, Gutenberg e `free_read_url` restano intatti.
