# jacopoz — API Reference

Three surfaces, all through `@supabase/supabase-js`:
1. **PostgREST** — auto REST over tables, authorized by RLS.
2. **RPC** — SQL/PLpgSQL functions for search, discovery, feed, and racy write actions.
3. **`ingest-book` Edge Function** — the catalog writer.

Every call carries the user's JWT. RLS (not the client) decides what a row-level request may read/write.

---

## 1. PostgREST (tables)

Access is governed by the RLS policies in `DATABASE.md`. General posture: **reads open, writes
owner-scoped.** Below, `supabase` is an authenticated client.

### Shelves (`user_books`)

```ts
// Add / update a shelf entry (RLS: user_id must equal auth.uid()).
await supabase.from('user_books').upsert({
  user_id: session.user.id,
  book_id,
  status: 'read',      // 'want_to_read' | 'reading' | 'read' | null
  liked: true,
  rating: 5,           // 1..5, canonical rating (see DATABASE.md §5)
}, { onConflict: 'user_id,book_id' });

// Read a user's public shelf.
const { data } = await supabase
  .from('user_books')
  .select('book_id, status, liked, rating, books(*)')
  .eq('user_id', someUserId)
  .eq('status', 'read');

// Remove a shelf entry.
await supabase.from('user_books').delete().match({ user_id: me, book_id });
```
> A row must carry ≥1 signal (`user_books_not_empty`): `status`, `liked=true`, or a `rating`.

### Reviews (`reviews`)

```ts
// Create (RLS: user_id = auth.uid(); one review per (user, book)).
const { data: review } = await supabase.from('reviews').insert({
  user_id: me, book_id, rating: 4,
  body: 'Gripping and tight.', contains_spoilers: false,
}).select().single();

// Read visible reviews for a book.
const { data } = await supabase
  .from('reviews')
  .select('*, profiles(username, display_name, avatar_url)')
  .eq('book_id', book_id)
  .eq('status', 'visible')
  .order('created_at', { ascending: false });
```
> `quality_score` is set server-side by a trigger; do not send it.

### Comments (`comments`)

```ts
await supabase.from('comments').insert({
  review_id, user_id: me,
  parent_comment_id: null,        // set to a top-level comment id for a reply
  body: 'Agreed, the ending lands.',
});

const { data } = await supabase
  .from('comments')
  .select('*, profiles(username, avatar_url)')
  .eq('review_id', review_id)
  .eq('status', 'visible')
  .order('created_at', { ascending: true });
```

### Follows (`follows`)

```ts
await supabase.from('follows').insert({ follower_id: me, following_id: target });  // follow
await supabase.from('follows').delete().match({ follower_id: me, following_id: target }); // unfollow
```
> `profiles.followers_count` / `following_count` update via trigger — read them from `profiles`.

### Genre prefs (`user_genre_prefs`) — onboarding

```ts
await supabase.from('user_genre_prefs')
  .upsert(picked.map(slug => ({ user_id: me, genre_slug: slug })));
await supabase.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('id', me);
```

### App config (`app_config`) — read at launch

```ts
const { data } = await supabase.from('app_config').select('key, value');
// { ads_enabled:false, amazon_affiliate_tag:'jacopoz-20', premium_enabled:false, min_app_version:'0.1.0' }
```

---

## 2. RPC functions

Call via `supabase.rpc(name, params)`. Composite return types are documented field-by-field below.

### search_books(p_query, p_limit, p_offset) → setof book_card

| Param | Type | Default | Notes |
|---|---|---|---|
| `p_query` | text | `''` | Empty → returns trending order. Accent-insensitive FTS + trigram fallback for typos/short queries. |
| `p_limit` | int | 20 | |
| `p_offset` | int | 0 | |

```ts
const { data } = await supabase.rpc('search_books', { p_query: 'dune', p_limit: 20, p_offset: 0 });
```
Grants: `authenticated`, `anon`.

### get_trending_books(p_limit, p_offset) → setof book_card
Popularity with a recency tilt (+25% weight for books ≤3 years old). Cold-start backstop for Home.
```ts
const { data } = await supabase.rpc('get_trending_books', { p_limit: 20 });
```
Grants: `authenticated`, `anon`.

### get_recommendations(p_limit, p_offset) → setof book_reco
Personalized blend (0.35 genre / 0.25 author / 0.25 collaborative-lite / 0.15 popularity). Excludes the
caller's shelf books. SECURITY DEFINER; uses `auth.uid()`. See `ALGORITHMS.md`.
```ts
const { data } = await supabase.rpc('get_recommendations', { p_limit: 20, p_offset: 0 });
```
Grants: `authenticated`.

### get_community_feed(p_limit, p_offset) → setof feed_item
Non-chronological ranked review feed for the viewer (0.30 engagement / 0.20 quality / 0.20 affinity /
0.30 freshness, 48h half-life). Excludes own + non-visible reviews. SECURITY DEFINER; uses `auth.uid()`.
```ts
const { data } = await supabase.rpc('get_community_feed', { p_limit: 20, p_offset: 0 });
```
Grants: `authenticated`.

### toggle_like(p_target_type, p_target_id) → (liked bool, like_count int)
Idempotent like/unlike for a review or comment; returns the resulting state in one round trip.
```ts
const { data } = await supabase.rpc('toggle_like', { p_target_type: 'review', p_target_id: reviewId });
// data[0] -> { liked: true, like_count: 12 }
```
Grants: `authenticated`. Raises `authentication required` if unauthenticated.

### report_content(p_target_type, p_target_id, p_reason, p_note?) → void
Files a report; re-reporting the same target is a silent no-op (unique constraint).
`p_target_type` ∈ `review | comment | profile | book`.
```ts
await supabase.rpc('report_content', {
  p_target_type: 'review', p_target_id: reviewId, p_reason: 'spam', p_note: 'ad link',
});
```
Grants: `authenticated`.

### moderate_content(p_target_type, p_target_id, p_status) → void
Sets visibility of a review/comment (`visible|hidden|removed`) and auto-resolves open reports on the
target. Guarded by `is_moderator()`; SECURITY DEFINER.
```ts
await supabase.rpc('moderate_content', { p_target_type: 'review', p_target_id: reviewId, p_status: 'removed' });
```
Grants: `authenticated` (rejected unless caller is moderator/admin).

### is_premium(p_user?) → boolean
Gating source of truth; defaults to `auth.uid()`, false when no active premium row.
```ts
const { data: premium } = await supabase.rpc('is_premium');
```
Grants: `authenticated`.

### amazon_affiliate_url(p_isbn) → text
Builds an Amazon Associates search URL for an ISBN; tag from `app_config.amazon_affiliate_tag`
(default `jacopoz-20`). Returns `null` when ISBN is empty → hide the buy button.
```ts
const { data: url } = await supabase.rpc('amazon_affiliate_url', { p_isbn: book.isbn_13 });
```
Grants: `authenticated`, `anon`.

---

### Composite return shapes

**`book_card`** — any "row of books":

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | book id |
| `title` | text | |
| `subtitle` | text | |
| `authors` | text[] | |
| `cover_url` | text | hotlinked cover |
| `published_year` | smallint | |
| `categories` | text[] | genre slugs |
| `avg_rating` | numeric | `book_avg_rating` (2 dp) or null |
| `reads_count` | int | denormalized |
| `saves_count` | int | denormalized |
| `likes_count` | int | denormalized |
| `reviews_count` | int | denormalized |

**`book_reco`** — `book_card` **plus**:

| Field | Type | Meaning |
|---|---|---|
| `score` | numeric | blended reco score (4 dp) |
| `reason` | text | `Because you read authors you love` / `Popular with readers like you` / `Matches your favourite genres` / `Trending on jacopoz` |

**`feed_item`** — one ranked review:

| Field | Type | Meaning |
|---|---|---|
| `review_id` | uuid | |
| `book_id` | uuid | |
| `book_title` | text | |
| `book_cover_url` | text | |
| `book_authors` | text[] | |
| `author_id` | uuid | review author profile id |
| `author_username` | text | |
| `author_display_name` | text | |
| `author_avatar_url` | text | |
| `rating` | smallint | review's display rating |
| `body` | text | |
| `contains_spoilers` | boolean | blur until tapped |
| `like_count` | int | |
| `comment_count` | int | |
| `created_at` | timestamptz | |
| `viewer_has_liked` | boolean | current viewer's like state |
| `score` | numeric | feed ranking score (4 dp) |

---

## 3. Edge Function: `ingest-book`

`POST` to `/functions/v1/ingest-book`. `verify_jwt = true` (config.toml) → send the user's JWT. Runs
under service_role (bypasses RLS), the **single writer to `public.books`**. Resolves external metadata
(Google Books, then Open Library fallback) into canonical rows, deduping by ISBN-13 then `dedup_key`.

**Request body — exactly one of:**

| Body | Behavior |
|---|---|
| `{ "isbn": "9780441172719" }` | Import a single edition (Google `isbn:` search, else Open Library by ISBN). |
| `{ "googleVolumeId": "abc123" }` | Import a specific Google Books volume. |
| `{ "query": "dune", "limit": 10 }` | Search Google Books, import top N (limit ≤ 40, default 10). |

Missing all three → `400 { "error": "provide isbn, googleVolumeId or query" }`. Non-POST → `405`.

**Response:** `{ "books": BookRow[] }` — canonical `public.books` rows (existing or newly created). Rows
with no title or no authors are skipped. Provider ids are recorded in `book_external_ids` (idempotent).

```ts
const { data } = await supabase.functions.invoke('ingest-book', { body: { query: 'brandon sanderson', limit: 5 } });
// data.books -> canonical book rows
```
Secrets read by the function: `GOOGLE_BOOKS_API_KEY` (optional, raises quota), `OPEN_LIBRARY_USER_AGENT`,
plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (injected).

---

## 4. Analytics events vocabulary

Write to `analytics_events` (`{ name, props, user_id }`, INSERT-only for the owner). Keep names in this
small, documented set; put context in `props`.

| Event `name` | When | Suggested `props` |
|---|---|---|
| `onboarding_completed` | taste picker finished (`onboarded_at` set) | `{ genres: string[] }` |
| `book_viewed` | book page opened | `{ book_id, source: 'home'|'feed'|'search'|'profile' }` |
| `shelf_added` | `user_books` upsert | `{ book_id, status, liked, rating }` |
| `review_created` | review inserted | `{ book_id, rating, length }` |
| `review_liked` | `toggle_like` on a review → liked | `{ review_id }` |
| `comment_created` | comment inserted | `{ review_id, is_reply }` |
| `affiliate_click` | buy button tapped | `{ book_id, isbn_13 }` |
| `search_performed` | `search_books` issued | `{ query_len, result_count }` |

Additional useful (optional): `follow_added`, `feed_impression`, `reco_impression`, `content_reported`.
