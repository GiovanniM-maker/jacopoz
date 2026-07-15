# jacopoz — Algorithms Deep Dive

Two read-side "algorithms" power the product: the **recommendation engine** (`get_recommendations`) and
the **community feed ranking** (`get_community_feed`). Both live entirely in `0006_functions_search_feed_reco.sql`
as plain SQL/PLpgSQL. No ML, no background jobs. Weights are constants at the top of each function — the
only thing you tune.

---

## 1. Recommendation engine — `get_recommendations`

Returns `setof book_reco` (`book_card` + `score` + `reason`), ordered by `score desc`, tie-broken by raw
popularity. SECURITY DEFINER, uses `auth.uid()`. **Books already on the caller's shelf are excluded.**

### The four signals (exact weights from 0006)

```
score = 0.35 * genre_affinity      -- prefs + genres of liked/read books
      + 0.25 * author_affinity     -- authors of liked/read books
      + 0.25 * collaborative       -- books liked by taste-neighbours
      + 0.15 * popularity          -- log-normalized global popularity
```
Final `score = round(0.35*genre + 0.25*author + 0.25*collab + 0.15*pop, 4)`.

**Positive signals** define a user's taste: a shelf book that is `liked`, `status='read'`, or
`rating >= 4`.

| Signal | Definition in SQL | Range |
|---|---|---|
| `genre_aff` | share of the book's `categories` that intersect **my_genres** = explicit `user_genre_prefs` ∪ categories of my positive books; `count(matches) / max(array_length(categories),1)` | 0..1 |
| `author_aff` | `1` if the book shares **any** author with a positive book (`my_authors`), else `0` | 0 or 1 |
| `collab_aff` | `sum(neighbour_overlap)` for the book, normalized by `max_collab`. **Neighbours** = up to 50 other users ranked by count of shared positive books; **collab candidates** = books those neighbours rate positively | 0..1 |
| `pop_aff` | `(reads_count + saves_count + likes_count) / max_pop` across all books | 0..1 |

### Cold-start handling

A brand-new user with zero shelf history still gets ranked results:
- `my_genres` is seeded by **explicit onboarding `user_genre_prefs`** even with no positive books →
  `genre_aff` is meaningful immediately (weight 0.35).
- `pop_aff` (0.15) is always available as a floor.
- `author_aff` / `collab_aff` are simply 0 until the user has positive books / taste-neighbours.
- Net: the "Per te" row is **never empty**; it degrades to genre + popularity. This is the primary
  cold-start fix (paired with the seed catalog).

### Shelf exclusion

`scored` selects `from books b where b.id not in (select book_id from my_books)`, where `my_books` is
every book the user has any `user_books` row for. You never get recommended a book already on any of
your shelves.

### Reason strings (priority order)

Computed per card by the first matching branch:

| Condition | `reason` |
|---|---|
| `author_aff > 0` | `Because you read authors you love` |
| else `collab_aff > 0` | `Popular with readers like you` |
| else `genre_aff > 0` | `Matches your favourite genres` |
| else | `Trending on jacopoz` |

These map directly onto Netflix-style Home row labels (see `PRD.md` §5).

### Worked example — "The Way of Kings" = **0.925**

User profile: fantasy lover, has **read Brandon Sanderson** (Mistborn on the `read` shelf, rated 5) and
picked `fantasy` in onboarding. Candidate: *The Way of Kings* by Brandon Sanderson (`categories =
['fantasy']`), not yet on the user's shelf.

| Signal | Value | Why | Contribution |
|---|---|---|---|
| `genre_aff` | `1.00` | book is `['fantasy']`; all categories ∈ my_genres | `0.35 × 1.00 = 0.350` |
| `author_aff` | `1.00` | shares author "Brandon Sanderson" with a positive book | `0.25 × 1.00 = 0.250` |
| `collab_aff` | `0.70` | strong overlap: readers who loved Mistborn also love this | `0.25 × 0.70 = 0.175` |
| `pop_aff` | `1.00` | among the most-read fantasy in the catalog | `0.15 × 1.00 = 0.150` |
| **score** | | `round(0.350+0.250+0.175+0.150, 4)` | **`0.9250`** |

`author_aff > 0` wins the reason branch → **reason = "Because you read authors you love"**. This card
tops the "Per te" / "Because you read Brandon Sanderson" row.

### How to swap for ML later

The contract is the **signature and return type**, not the body:
```
get_recommendations(p_limit int, p_offset int) returns setof public.book_reco
```
To move to ML: keep this exact signature and `book_reco` shape, and replace the function body with
either (a) a read from a precomputed `recommendations(user_id, book_id, score, reason)` table populated
by an external model, or (b) a call out to a scorer. The app keeps calling
`supabase.rpc('get_recommendations', …)` unchanged — no client change, no contract break. Until then,
tuning = edit the four weight constants.

---

## 2. Community feed ranking — `get_community_feed`

Returns `setof feed_item` (review + author + book + `viewer_has_liked` + `score`), ordered by
`score desc`, tie-broken by `created_at desc`. Excludes the viewer's own reviews and non-`visible`
content. SECURITY DEFINER, uses `auth.uid()`.

### The four terms (exact from 0006)

```
score = 0.30 * engagement   -- ln(1 + likes + 1.5*comments), normalized by max over visible reviews
      + 0.20 * quality      -- reviews.quality_score (precomputed)
      + 0.20 * affinity     -- follows author -> 1.0 ; else shares a genre -> 0.5 ; else 0.0
      + 0.30 * freshness     -- exp(-age_hours / 48)
```
`freshness` half-life constant `c_half_life_hours = 48`.

| Term | Definition | Notes |
|---|---|---|
| engagement | `ln(1 + like_count + 1.5*comment_count) / max_eng` | comments weighted 1.5× likes; log-damped; `max_eng` normalizes across visible reviews |
| quality | `reviews.quality_score` (already in [0,1]) | precomputed on write — no per-request cost |
| affinity | `1.0` if viewer follows the author; else `0.5` if the book shares a genre with the viewer's taste (`user_genre_prefs` ∪ genres of liked/read books); else `0.0` | personalizes to the viewer |
| freshness | `exp(-age_hours / 48)` | 1.0 at post time, ~0.5 at 48h, ~0.25 at 96h |

### The quality-score heuristic — `compute_review_quality(body, rating)`

Immutable, transparent, deliberately not ML; stored on `reviews.quality_score` by the
`reviews_before_write` trigger:
```
quality = least(1.0,
    0.15                                                -- base for existing
  + least(char_length(body), 600) / 600 * 0.65         -- length, saturates at 600 chars
  + (rating is not null ? 0.20 : 0))                    -- has a rating
```
Consequences: a one-line rated review already scores ~0.35–0.45; a ~600-char rated review caps at `1.0`.
Length beyond 600 chars adds nothing — no incentive for padding. A rating is worth a flat +0.20.

### Why non-chronological

Pure chronological dies at small scale: a single prolific user floods the feed and great older reactions
vanish. The blend keeps the feed **alive** (freshness 0.30 + affinity 0.20 dominate at low volume) while
letting **engagement and quality** matter more as content accumulates. A superb review from someone you
follow can still out-rank a fresher mediocre one.

### Tuning guidance: low vs high volume

| Situation | Symptom | Adjustment |
|---|---|---|
| **Low volume (early beta)** | feed feels empty/stale, same items | keep freshness high (0.30) or raise; lean on affinity (0.20↑) so follows/genre carry it; engagement contributes little (few likes) — that's fine |
| **Growing volume** | good reviews buried under fresh noise | raise engagement (0.30→0.35) and quality (0.20→0.25), lower freshness (0.30→0.20) |
| **High volume (v2)** | need per-user diversity, anti-flooding | add a per-author cap / diversity term, or move to a learned ranker behind the same `feed_item` contract |
| **Spoiler / sensitivity** | not a ranking knob | handled by `contains_spoilers` (blur) and moderation `status`, not the score |

All tuning is editing the four weight constants (and `c_half_life_hours`) at the top of one function and
shipping a migration — the app contract (`feed_item`) is unchanged.
