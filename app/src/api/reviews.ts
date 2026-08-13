import { supabase } from "@/lib/supabase";
import type { Review, ReviewWithAuthor, UUID } from "@/types/database";
import { track } from "./analytics";

// Nota: non esiste più una `getBookReviews(bookId)`. Filtrava su `book_id`,
// cioè su una singola edizione, ed era il difetto che W1b è servito a togliere:
// chi apriva l'Adelphi non vedeva la recensione scritta sull'Einaudi. La
// lettura giusta è `getBookReviewsRanked`, che segue l'opera. La vecchia
// funzione non era chiamata da nessuno, e lasciarla in giro significava
// offrire di nuovo la strada sbagliata a chi ne avesse avuto bisogno.

export async function getReview(id: UUID, viewerId?: UUID): Promise<ReviewWithAuthor> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*, author:profiles!reviews_user_id_fkey(id,username,display_name,avatar_url)")
    .eq("id", id)
    .single();
  if (error) throw error;
  const [withLike] = await attachViewerLikes([data as unknown as ReviewWithAuthor], viewerId);
  return withLike;
}

export interface UserReview extends Review {
  book: { id: UUID; title: string; cover_url: string | null };
  author: { id: UUID; username: string; display_name: string; avatar_url: string | null };
}

/** A user's own reviews with book + author, for the profile Reviews tab. */
export async function getUserReviews(userId: UUID): Promise<UserReview[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(
      "*, book:books(id,title,cover_url), author:profiles!reviews_user_id_fkey(id,username,display_name,avatar_url)",
    )
    .eq("user_id", userId)
    .eq("status", "visible")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as UserReview[];
}

/** The caller's own review of this **work**, if any — one per work, not per
 *  edition. Looking it up by edition would show an empty form to someone who
 *  has already written about the book from a different edition. */
export async function getMyReview(_userId: UUID, bookId: UUID): Promise<Review | null> {
  const { data, error } = await supabase.rpc("get_my_review", { p_book_id: bookId });
  if (error) throw error;
  return (data as Review) ?? null;
}

/** Create or update the caller's review of the work this book belongs to.
 *
 *  Passa da una RPC e non da un `upsert ... on conflict (user_id, book_id)`:
 *  con il vincolo «una recensione per opera» quell'upsert sbaglia proprio nel
 *  caso che W1b sistema — chi ha recensito un'edizione e scrive da un'altra non
 *  trova conflitto, tenta un inserimento e riceve un errore di vincolo invece
 *  di modificare quello che aveva già scritto.
 *
 *  Il voto resta anche su `user_books`, che è la fonte della media del libro. */
export async function upsertReview(
  userId: UUID,
  bookId: UUID,
  input: { body: string; rating: number | null; contains_spoilers?: boolean },
): Promise<Review> {
  const { data, error } = await supabase.rpc("upsert_review", {
    p_book_id: bookId,
    p_body: input.body,
    p_rating: input.rating,
    p_spoilers: input.contains_spoilers ?? false,
  });
  if (error) throw error;

  if (input.rating != null) {
    const { error: ubErr } = await supabase
      .from("user_books")
      .upsert(
        { user_id: userId, book_id: bookId, rating: input.rating },
        { onConflict: "user_id,book_id" },
      );
    if (ubErr) throw ubErr;
  }

  void track("review_created", { bookId, hasRating: input.rating != null });
  return data as Review;
}

/** Ids of every edition of the works the user has already reviewed.
 *
 *  Restituire solo le edizioni recensite riproporrebbe l'Adelphi a chi ha
 *  scritto sull'Einaudi dello stesso libro. */
export async function getReviewedBookIds(_userId: UUID): Promise<Set<UUID>> {
  const { data, error } = await supabase.rpc("get_reviewed_book_ids");
  if (error) throw error;
  return new Set(((data ?? []) as UUID[]));
}

export async function deleteReview(id: UUID): Promise<void> {
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) throw error;
}

// Annotate a list of reviews with whether the viewer liked each one.
async function attachViewerLikes(
  reviews: ReviewWithAuthor[],
  viewerId?: UUID,
): Promise<ReviewWithAuthor[]> {
  if (!viewerId || reviews.length === 0) return reviews;
  const ids = reviews.map((r) => r.id);
  const { data } = await supabase
    .from("likes")
    .select("target_id")
    .eq("user_id", viewerId)
    .eq("target_type", "review")
    .in("target_id", ids);
  const liked = new Set((data ?? []).map((l) => l.target_id));
  return reviews.map((r) => ({ ...r, viewer_has_liked: liked.has(r.id) }));
}
