import { supabase } from "@/lib/supabase";
import type { Review, ReviewWithAuthor, UUID } from "@/types/database";
import { track } from "./analytics";

/** Visible reviews for a book, newest first, joined with author + viewer like. */
export async function getBookReviews(
  bookId: UUID,
  viewerId?: UUID,
): Promise<ReviewWithAuthor[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(
      "*, author:profiles!reviews_user_id_fkey(id,username,display_name,avatar_url)",
    )
    .eq("book_id", bookId)
    .eq("status", "visible")
    .order("like_count", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const reviews = (data ?? []) as unknown as ReviewWithAuthor[];
  return attachViewerLikes(reviews, viewerId);
}

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

/** The current user's own review of a book, if any (one per book). */
export async function getMyReview(userId: UUID, bookId: UUID): Promise<Review | null> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as Review) ?? null;
}

/** Create or update the caller's review. Rating is also a shelf signal, so
 *  we keep user_books.rating in sync as the single source of truth. */
export async function upsertReview(
  userId: UUID,
  bookId: UUID,
  input: { body: string; rating: number | null; contains_spoilers?: boolean },
): Promise<Review> {
  const { data, error } = await supabase
    .from("reviews")
    .upsert(
      {
        user_id: userId,
        book_id: bookId,
        body: input.body,
        rating: input.rating,
        contains_spoilers: input.contains_spoilers ?? false,
      },
      { onConflict: "user_id,book_id" },
    )
    .select("*")
    .single();
  if (error) throw error;

  // Sync the canonical rating onto the shelf (drives book average rating).
  if (input.rating != null) {
    await supabase
      .from("user_books")
      .upsert(
        { user_id: userId, book_id: bookId, rating: input.rating },
        { onConflict: "user_id,book_id" },
      );
  }

  void track("review_created", { bookId, hasRating: input.rating != null });
  return data as Review;
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
