# jacopoz — Founder / CTO Critical Review

A candid pass over the risks that actually kill a social-discovery reading app, each with **why it's a
problem**, a **severity**, and the **fix already in the schema**. Then the simplifications we imposed to
ship a private beta at ~€0 infra, and the MVP/Beta/v2 line.

---

## 1. Cold-start & empty community — **CRITICAL**

**Why it's a problem.** A social discovery app with no content and no graph shows a new user a blank
Home and a dead feed. This is the classic two-sided cold-start: reco needs interactions, interactions
need users who came for the reco. First-session emptiness is the #1 churn cause for this category.

**Fix (three layers):**
1. **Onboarding taste picker** → `user_genre_prefs` (0005) captures explicit genres *before* any
   behavior. This is the primary cold-start signal.
2. **Blended reco cascade** → `get_recommendations` (0006) degrades gracefully: genre affinity (0.35)
   from explicit prefs, then popularity (0.15) as a floor. With zero history a user still gets ranked
   results with reason `"Matches your favourite genres"` / `"Trending on jacopoz"`. `get_trending_books`
   is the always-populated backstop.
3. **Seed content** → `seed.sql` ships a 20-book curated catalog with hotlinked covers + a genre
   vocabulary, so search/Home/genre rows are never empty on a fresh project. (Seeded reviews are a P0
   TODO to make "Più discussi"/feed non-empty — see `ROADMAP-BACKLOG.md`.)

---

## 2. Low interaction frequency — **HIGH**

**Why it's a problem.** People finish a book every few weeks, not every day. If the only way to
contribute is a long review, the feed starves and retention has nothing to feed on.

**Fix.** Contribution is deliberately cheap and multi-tiered:
- **Rating-only / like-only shelf rows** are first-class: `user_books` requires only *one* signal
  (`user_books_not_empty` check: status OR liked OR rating). A 1-tap rating is a valid interaction and
  feeds reco/collaborative signal.
- **Short reviews** allowed — `reviews.body` is 1–5000 chars but the quality heuristic saturates at 600
  chars, so a two-line review scores well. No length pressure.
- **Progress micro-posts deferred** (v2) rather than faked now: we do not want half-built low-value post
  types diluting the beta feed. Frequency in beta comes from ratings + likes + short reviews.

---

## 3. Book identity / dedup — **HIGH**

**Why it's a problem.** Google Books and Open Library return many editions/volumes per work with
inconsistent ISBNs and titles. Naïve ingestion creates duplicate books, splitting ratings and reviews
and wrecking discovery.

**Fix.** A **canonical `books` table** with an explicit dedup strategy (0002 + `ingest-book`):
- Resolve order: **ISBN-13 unique** first, then **`dedup_key`** = `slugify(title)|slugify(first-author)`
  (unique index). The Edge Function checks both before inserting.
- **External-id map** (`book_external_ids`: provider + external_id → book_id) records every provider id
  so repeat lookups resolve instantly and idempotently to the same canonical row.
- **Single writer:** only the `ingest-book` Edge Function (service_role) writes `books`; clients are
  read-only on the catalog (RLS). No client-side duplicate creation possible.

---

## 4. Moderation from day one — **HIGH**

**Why it's a problem.** Even a 100-user beta with user-generated reviews/comments needs a takedown path
and an audit trail. Retrofitting moderation after an incident is painful and reputationally costly.

**Fix.** Moderation is built in, not bolted on:
- **Report flow:** `report_content` RPC → `reports` table, one open report per (reporter, target),
  re-report is a silent no-op.
- **Content lifecycle:** `content_status` enum `visible → hidden → removed` on `reviews`/`comments`.
  `visible` shows; `hidden` is recoverable (author/auto-filter); `removed` is kept for audit, never
  shown.
- **Moderator role:** `moderate_content` (SECURITY DEFINER, guarded by `is_moderator()`) sets status
  and auto-resolves open reports. Roles: `user` / `moderator` / `admin` on `profiles.role`. RLS lets
  authors + moderators see their non-visible content; the public sees only `visible`.

---

## 5. Feed ranking on tiny volume — **MEDIUM**

**Why it's a problem.** Fancy ranking on 50 reviews overfits and feels arbitrary; pure chronological
feels dead. Both fail at small scale.

**Fix.** `get_community_feed` (0006) stays **simple and transparent** and weights **freshness (0.30) +
affinity (0.20)** heavily so a small graph still feels alive, with engagement (0.30) and quality (0.20)
providing signal as volume grows. Freshness uses a 48h half-life. All weights are constants at the top
of one SQL function — tune, don't re-architect (see `ALGORITHMS.md` low-vs-high-volume guidance).

---

## 6. Monetization timing — **MEDIUM**

**Why it's a problem.** Monetizing a private beta annoys early users and distorts metrics; but not
architecting revenue means a painful migration of hot tables later.

**Fix.** All three channels are **architected now, mostly dormant** (0009):
- **Affiliate — ENABLED in beta.** Zero UX cost, real upside. `amazon_affiliate_url(isbn)` builds an
  Amazon Associates link; tag lives in `app_config` (rotate without an app update).
- **Premium (ad-free) — modelled, nothing gated.** `entitlements` + `is_premium()` exist; billing state
  written by a webhook via service_role. `premium_enabled` flag = false.
- **Ads — config present, OFF.** `ads_enabled` = false in `app_config`. No ad SDK in beta.

---

## 7. Cover images cost / rights — **MEDIUM**

**Why it's a problem.** Storing and serving cover images has storage/CDN cost and licensing questions;
we want ~€0 infra.

**Fix.** **Hotlink covers** from providers (`books.cover_url` points at Open Library / Google
thumbnails, normalized to https). No cover bytes stored in beta. Only **user avatars** live in Supabase
**Storage** (config caps at 5 MiB). If hotlinking becomes a reliability problem we cache to Storage
later — the column is provider-agnostic, so no schema change is needed.

---

## Simplifications imposed (to ship a €0 private beta)

| Simplification | Consequence / rationale |
|---|---|
| **Supabase is the entire backend** | Postgres + Auth + Storage + Edge Functions. No separate API service, no ops. |
| **Algorithms as SQL RPC** | Search, trending, reco, feed are plain SQL/PLpgSQL functions. Transparent, versioned with migrations, swappable without touching the app. |
| **No ML** | Reco/feed are hand-weighted heuristics. Same RPC signature/return type reserved for a future ML swap. |
| **One Expo codebase** | iOS + Android + Web from a single React Native/Expo app. No native fork. |
| **No realtime** | Client polls / React Query refetch; denormalized counters make reads cheap. Realtime is v2. |
| **Denormalized counters via triggers** | Reads never aggregate; every count (followers, likes, reviews, popularity, rating_sum/count) is trigger-maintained. |
| **Hotlinked covers** | No image pipeline/CDN in beta. |

---

## MVP vs Beta vs v2 summary

**MVP (private, internal):** auth + onboarding taste, canonical catalog + search + on-demand ingestion,
book page, shelves (status/like/rating), short reviews, profile. Proves the catalog + shelf + write loop.

**Beta (100–500 invited users):** everything in MVP **plus** the social layer that is the actual product
— follows, likes, comments, the **non-chronological community feed**, **blended recommendations**,
Netflix-style Home rows, reporting + moderation, analytics events, avatar upload, **affiliate links on**.
Gamification and premium remain scaffolded/dormant; ads OFF.

**v2 (public):** activate gamification (XP/levels/streaks/badges), premium features + paywall, ad
network, push + in-app notifications, realtime feed, reading-progress posts, book clubs, i18n, warehouse
analytics. Crucially, v2 requires **no migration of hot tables** — gamification/monetization/activity
tables are already wired (see `0007`–`0009`).
