import { supabase } from "@/lib/supabase";
import type { BookCard, ShelfStatus, UserBook, UUID } from "@/types/database";
import { track } from "./analytics";

/** The current user's shelf row for a book (or null if none). */
export async function getUserBook(userId: UUID, bookId: UUID): Promise<UserBook | null> {
  const { data, error } = await supabase
    .from("user_books")
    .select("*")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as UserBook) ?? null;
}

/**
 * Upsert a shelf interaction. Any combination of status / liked / rating is
 * valid as long as at least one signal is set (enforced by a DB constraint).
 * Passing all-null removes the row (no interaction left).
 */
export async function setShelf(
  userId: UUID,
  bookId: UUID,
  patch: { status?: ShelfStatus | null; liked?: boolean; rating?: number | null },
): Promise<UserBook | null> {
  const existing = await getUserBook(userId, bookId);
  const next = {
    status: patch.status !== undefined ? patch.status : (existing?.status ?? null),
    liked: patch.liked !== undefined ? patch.liked : (existing?.liked ?? false),
    rating: patch.rating !== undefined ? patch.rating : (existing?.rating ?? null),
  };

  // If nothing meaningful remains, delete the ghost row.
  if (!next.status && !next.liked && next.rating == null) {
    if (existing) {
      await supabase.from("user_books").delete().eq("user_id", userId).eq("book_id", bookId);
      void track("shelf_removed", { bookId });
    }
    return null;
  }

  const row = {
    user_id: userId,
    book_id: bookId,
    ...next,
    finished_at: next.status === "read" ? new Date().toISOString() : (existing?.finished_at ?? null),
    started_at:
      next.status === "reading" && !existing?.started_at
        ? new Date().toISOString()
        : (existing?.started_at ?? null),
  };

  const { data, error } = await supabase
    .from("user_books")
    .upsert(row, { onConflict: "user_id,book_id" })
    .select("*")
    .single();
  if (error) throw error;

  if (patch.status !== undefined) void track("shelf_added", { bookId, status: next.status });
  if (patch.liked) void track("book_liked", { bookId });
  if (patch.rating != null) void track("book_rated", { bookId, rating: next.rating });

  return data as UserBook;
}

/** Books on a given shelf for a user, as cards for a grid. */
export async function getShelfBooks(
  userId: UUID,
  filter: { status?: ShelfStatus; liked?: boolean },
): Promise<BookCard[]> {
  let q = supabase
    .from("user_books")
    .select(
      "book:books(id,title,subtitle,authors,cover_url,published_year,categories,reads_count,saves_count,likes_count,reviews_count,rating_sum,rating_count)",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (filter.status) q = q.eq("status", filter.status);
  if (filter.liked) q = q.eq("liked", true);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? [])
    .map((r: any) => r.book)
    .filter(Boolean)
    .map((b: any) => ({
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      authors: b.authors,
      cover_url: b.cover_url,
      published_year: b.published_year,
      categories: b.categories,
      avg_rating: b.rating_count > 0 ? Number((b.rating_sum / b.rating_count).toFixed(2)) : null,
      reads_count: b.reads_count,
      saves_count: b.saves_count,
      likes_count: b.likes_count,
      reviews_count: b.reviews_count,
    }));
}
