# jacopoz — Local Development Setup

Get the database + Edge Function + Expo app running locally. The database backend is already built
(`supabase/migrations/0001..0010`, `seed.sql`); this is about standing it up and pointing the app at it.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | LTS |
| npm | 10+ | bundled with Node 20 |
| Supabase CLI | latest | `npm i -g supabase` or `brew install supabase/tap/supabase` |
| Docker | latest | required by `supabase start` (local stack) |
| Expo | via `npx expo` | no global install needed; app uses Expo 52 |
| Git | any | |

For device testing: **Expo Go** app on your phone (earliest beta path), or Xcode / Android Studio for
simulators.

---

## 2. Get the database running

Two options.

### Option A — local stack (recommended for dev)

```bash
cd /home/user/jacopoz
supabase start          # boots Postgres, Auth, Storage, PostgREST, Studio, edge runtime (Docker)
supabase db reset       # applies migrations 0001..0010 THEN seed.sql automatically
```
`supabase start` prints local URLs and keys — note the **API URL** (default `http://localhost:54321`),
**anon key**, and **service_role key**. Studio is at `http://localhost:54323`.

`supabase db reset` re-applies all migrations and runs `seed.sql` (genre vocabulary, `app_config` flags,
achievement catalog, 20-book curated catalog + external-id map).

### Option B — a hosted Supabase project

Create a project at supabase.com, then either link + push:
```bash
supabase link --project-ref YOUR-PROJECT-REF
supabase db push                                   # apply migrations
psql "$SUPABASE_DB_URL" -f supabase/seed.sql       # apply seed
```
or apply migrations + seed by hand with `psql` against `SUPABASE_DB_URL`.

---

## 3. Environment variables

Two env files (see `.gitignore` — both are ignored, never commit real values).

### Root `.env` (server tooling / Edge Functions) — copy from `.env.example`

```bash
cd /home/user/jacopoz
cp .env.example .env
```
Fill in from `supabase start` output (local) or the project dashboard (hosted):
```
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>   # server-only, never in the app
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
GOOGLE_BOOKS_API_KEY=                            # optional (raises quota)
OPEN_LIBRARY_USER_AGENT=jacopoz/0.1 (you@example.com)
```

### App `app/.env` (mobile client) — reference `app/.env.example`

The Expo app only ever needs the **public** values (URL + anon key). Expo exposes vars prefixed
`EXPO_PUBLIC_` to the client bundle. Create `app/.env`:
```
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```
> Never put `SUPABASE_SERVICE_ROLE_KEY` in `app/.env` — it bypasses RLS and must stay server-side. The
> anon key is safe to ship because RLS enforces access.

---

## 4. Run the Edge Function locally (optional but needed for search-ingest)

```bash
cd /home/user/jacopoz
supabase functions serve ingest-book --env-file .env
```
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected by the local runtime; `GOOGLE_BOOKS_API_KEY`
and `OPEN_LIBRARY_USER_AGENT` come from `.env`. Note `verify_jwt = true`, so calls need a valid JWT.

Smoke test:
```bash
curl -s -X POST http://localhost:54321/functions/v1/ingest-book \
  -H "Authorization: Bearer <a user JWT>" \
  -H "content-type: application/json" \
  -d '{"query":"dune","limit":3}'
```

---

## 5. Run the Expo app

```bash
cd /home/user/jacopoz/app
npm install
npx expo start
```
Then:
- press `i` (iOS simulator), `a` (Android emulator), or `w` (web), or
- scan the QR code with **Expo Go** on a physical device.

If testing on a physical device with a **local** Supabase, `localhost` won't resolve from the phone —
point `EXPO_PUBLIC_SUPABASE_URL` at your machine's LAN IP (`http://192.168.x.x:54321`) and confirm the
value is in `config.toml`'s `additional_redirect_urls` if doing auth redirects.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `supabase start` fails | Docker not running, or ports 54321–54323 in use. Start Docker; `supabase stop` then `start`. |
| Migrations error on reset | ensure you ran against a clean DB; `supabase db reset` drops + recreates. Extensions (`pgcrypto`, `pg_trgm`, `unaccent`) are created by `0001`. |
| App can't reach Supabase | wrong `EXPO_PUBLIC_SUPABASE_URL`; on a physical device use LAN IP, not `localhost`. |
| Auth email never arrives (local) | local mail is captured by Inbucket in the Supabase stack (see Studio) — check there; or relax `enable_confirmations` locally. |
| `ingest-book` returns 401 | `verify_jwt = true` — pass a real user JWT in `Authorization`. |
| `ingest-book` returns empty `books` | provider miss or junk rows (no title/authors are skipped); try an ISBN body. Google Books works keyless at low volume. |
| Covers not loading | hotlinked from providers; a broken URL just fails to render — expected until cover-fallback (P2). |
| RLS "permission denied" | you're writing a row where `... != auth.uid()`, or unauthenticated. Confirm the session/JWT. |
| Env var not picked up by Expo | must be prefixed `EXPO_PUBLIC_`; restart `expo start` after changing `app/.env`. |
