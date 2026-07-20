// =====================================================================
// Hand-written types mirroring the Supabase schema and RPC return shapes.
// Kept in sync with supabase/migrations. (Can later be replaced by
// `supabase gen types typescript` output — the shapes match on purpose.)
// =====================================================================

export type UUID = string;

export type ShelfStatus = "want_to_read" | "reading" | "read";
export type ContentStatus = "visible" | "hidden" | "removed";
export type LikeableType = "review" | "comment";
export type BookmarkType = "review" | "comment";
export type ReportTarget = "review" | "comment" | "profile" | "book";
export type UserRole = "user" | "moderator" | "admin";

export interface Profile {
  id: UUID;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  role: UserRole;
  followers_count: number;
  following_count: number;
  books_read_count: number;
  points: number;
  onboarded_at: string | null;
  created_at: string;
}

export interface Genre {
  slug: string;
  name: string;
  sort_order: number;
}

export interface Book {
  id: UUID;
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  cover_url: string | null;
  published_year: number | null;
  page_count: number | null;
  language: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  categories: string[];
  saves_count: number;
  reads_count: number;
  likes_count: number;
  reviews_count: number;
  rating_sum: number;
  rating_count: number;
  created_at: string;
}

export interface UserBook {
  user_id: UUID;
  book_id: UUID;
  status: ShelfStatus | null;
  liked: boolean;
  rating: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: UUID;
  user_id: UUID;
  book_id: UUID;
  rating: number | null;
  body: string;
  contains_spoilers: boolean;
  status: ContentStatus;
  like_count: number;
  comment_count: number;
  quality_score: number;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: UUID;
  review_id: UUID;
  user_id: UUID;
  parent_comment_id: UUID | null;
  body: string;
  status: ContentStatus;
  like_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
}

export interface BookList {
  id: UUID;
  user_id: UUID;
  name: string;
  description: string | null;
  is_public: boolean;
  book_count: number;
  follower_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileStats {
  books_read: number;
  reviews: number;
  comments: number;
  likes_received: number;
  likes_given: number;
  followers: number;
  following: number;
  lists: number;
}

// ---- RPC return shapes (composite types from 0006) -------------------

/** book_card — a "row of books" card. */
export interface BookCard {
  id: UUID;
  title: string;
  subtitle: string | null;
  authors: string[];
  cover_url: string | null;
  published_year: number | null;
  categories: string[];
  avg_rating: number | null;
  reads_count: number;
  saves_count: number;
  likes_count: number;
  reviews_count: number;
}

/** book_reco — a BookCard plus why it was recommended. */
export interface BookReco extends BookCard {
  score: number;
  reason: string;
}

/** feed_item — a ranked community-feed entry. */
export interface FeedItem {
  review_id: UUID;
  book_id: UUID;
  book_title: string;
  book_cover_url: string | null;
  book_authors: string[];
  author_id: UUID;
  author_username: string;
  author_display_name: string;
  author_avatar_url: string | null;
  rating: number | null;
  body: string;
  contains_spoilers: boolean;
  like_count: number;
  comment_count: number;
  created_at: string;
  viewer_has_liked: boolean;
  score: number;
}

/** A comment joined with its author, as rendered in a thread. */
export interface CommentWithAuthor extends Comment {
  author: Pick<Profile, "id" | "username" | "display_name" | "avatar_url">;
  viewer_has_liked?: boolean;
}

/** A review joined with its author, as rendered on a book page. */
export interface ReviewWithAuthor extends Review {
  author: Pick<Profile, "id" | "username" | "display_name" | "avatar_url">;
  viewer_has_liked?: boolean;
}
