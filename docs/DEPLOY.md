# jacopoz — Deploying the Beta

Concrete steps to ship the private beta: Supabase backend, mobile builds, optional web, moderator
promotion, and turning monetization on later.

---

## 1. Supabase (backend)

### Link the project
```bash
cd /home/user/jacopoz
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

### Push migrations
```bash
supabase db push          # applies supabase/migrations/0001..0010 to the linked project
```
Apply seed data (reference vocabulary + curated catalog + config flags) once:
```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```
> `seed.sql` is idempotent (`on conflict do nothing`), safe to re-run.

### Deploy the Edge Function
```bash
supabase functions deploy ingest-book
```
`config.toml` sets `verify_jwt = true` for `ingest-book`, so it requires a valid user JWT.

### Set function secrets
```bash
supabase secrets set \
  GOOGLE_BOOKS_API_KEY=your-google-books-key \
  OPEN_LIBRARY_USER_AGENT="jacopoz/0.1 (contact@yourdomain.example)"
```
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the function runtime automatically —
> do **not** set them as app secrets. Google Books works keyless at low volume; a key raises quota.
> Open Library needs no key but expects a descriptive User-Agent.

### Configure Auth
In the dashboard (Authentication → URL configuration), or `config.toml`:
- **Site URL:** `jacopoz://`
- **Additional redirect URLs:** `jacopoz://`, plus your web origin (e.g. `https://jacopoz.vercel.app`)
  and any Expo dev URLs (`exp://…`) you use.
- Keep **email confirmation ON** for production (`[auth.email] enable_confirmations = true`).
- Customize the confirmation email template + sender before inviting real users.

---

## 2. Mobile (Expo / EAS)

### Earliest beta — Expo Go
Point the app at the hosted project (`app/.env`: `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`), run `npx expo start`, share the QR / project link. Testers install
**Expo Go** and open it. Zero store review — fastest way to get 100–500 invited users reading.

### Store-track beta — EAS Build
```bash
cd /home/user/jacopoz/app
npm i -g eas-cli
eas login
eas build:configure
# iOS -> TestFlight
eas build --platform ios --profile preview
eas submit --platform ios
# Android -> internal track
eas build --platform android --profile preview
eas submit --platform android
```
Set the production Supabase env for the build profile (EAS secrets / `eas.json` env, using the
`EXPO_PUBLIC_*` names). Distribute via TestFlight (iOS) and Google Play internal testing (Android).

---

## 3. Web deploy (Vercel)

The repo ships a root `vercel.json` that builds the Expo web SPA from the `app/`
subdirectory, so a Vercel project connected to the repo root needs **no build
settings** — just environment variables. Every push to the branch triggers a deploy.

`vercel.json` (already committed) sets:

```jsonc
{
  "buildCommand": "cd app && npm install && npx expo export -p web",
  "outputDirectory": "app/dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] // SPA fallback
}
```

**Required — set these in Vercel → Project → Settings → Environment Variables**
(Production + Preview). They are baked into the client bundle at build time; the
anon key is public by design, so this is safe:

| Name | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<your-ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | your project's anon key |

Then add the resulting Vercel URL (e.g. `https://jacopoz.vercel.app`) to
**Supabase → Auth → URL Configuration → Redirect URLs** so email/auth links resolve.

To build the static site locally instead:

```bash
cd app && npx expo export -p web    # outputs app/dist
```

---

## 4. Promote a user to moderator

Roles live in `profiles.role` (`user` / `moderator` / `admin`); `is_moderator()` gates moderation and
`app_config` writes. There is no client path to elevate — do it in SQL (Studio SQL editor or psql):
```sql
update public.profiles
set role = 'moderator'          -- or 'admin'
where username = 'the_username';   -- or where id = '<uuid>'
```
The change takes effect on the user's next request (RLS re-evaluates `is_moderator()` per call).

---

## 5. Turning on monetization later (`app_config` flags)

All revenue channels are architected; beta ships with only affiliate live. Flip flags in `app_config`
(moderator-writable) — the client reads them at launch, so **no app update required**.

```sql
-- Enable the Premium upsell once gated features exist.
update public.app_config set value = 'true'::jsonb  where key = 'premium_enabled';

-- Turn on in-app ads (OFF for beta).
update public.app_config set value = 'true'::jsonb  where key = 'ads_enabled';

-- Rotate the Amazon Associates affiliate tag without shipping an app update.
update public.app_config set value = '"your-new-tag-20"'::jsonb where key = 'amazon_affiliate_tag';

-- Bump the soft minimum client version (forced-update nudge).
update public.app_config set value = '"0.2.0"'::jsonb where key = 'min_app_version';
```

Notes:
- **Affiliate** is already on: `amazon_affiliate_url(isbn)` uses `amazon_affiliate_tag` (default
  `jacopoz-20`); the buy button hides when a book has no ISBN.
- **Premium** requires wiring a billing webhook (RevenueCat/Stripe) that writes `entitlements` via
  **service_role**; `is_premium()` then gates features. `premium_enabled` only controls showing the
  upsell.
- **Ads** additionally require integrating an ad SDK in the app; the flag alone does not render ads.
- **Gamification** (v2) activates by running a SECURITY DEFINER / service_role points engine that
  appends to `xp_ledger` and updates `user_gamification` — no schema migration needed.

---

## 6. Post-deploy smoke check

```bash
# search works
curl -s "$SUPABASE_URL/rest/v1/rpc/search_books" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "content-type: application/json" \
  -d '{"p_query":"dune"}'

# ingestion works (needs a user JWT)
curl -s -X POST "$SUPABASE_URL/functions/v1/ingest-book" \
  -H "Authorization: Bearer <user JWT>" -H "content-type: application/json" \
  -d '{"isbn":"9780441172719"}'
```
Then, in the app: sign up → confirm email → onboarding taste → search → add to shelf → write a review →
open the feed → like a review. This is the release-gate e2e path (see `ROADMAP-BACKLOG.md` P0).
