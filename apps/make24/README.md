# Make24

A daily arithmetic puzzle game — make 24 from four numbers using +, −, ×, ÷.

Live at **[make24.app](https://make24.app)**

---

## Running locally

No build step required. Open `index.html` directly in a browser, or use any
static file server:

```sh
npx serve .
# then open http://localhost:3000
```

### Run the tests

```sh
npm install
npm test
```

Tests cover the puzzle solver, difficulty scoring, and streak logic (56 specs,
Jest with `--experimental-vm-modules`).

---

## Architecture overview

| File | Purpose |
|---|---|
| `index.html` | Single-page app shell |
| `supabase-service.js` | Supabase client init + all auth/RPC calls |
| `app.js` | Game logic, UI, sync orchestration |
| `speakeasy/speakeasy.js` | "After Hours" hard-mode (self-contained IIFE) |
| `speakeasy/speakeasy.css` | After Hours styles |
| `netlify/functions/ls-validate.js` | Serverless proxy for Lemon Squeezy license validation |
| `netlify.toml` | Netlify redirect rules |

---

## Environment variables / secrets

This is a static site — there are no server-side environment variables required
for the base game.

| Location | Value | Notes |
|---|---|---|
| `supabase-service.js` | Supabase URL + anon key | Anon key is safe to embed (RLS is the real security boundary). Rotate here if the key ever leaks. |
| `speakeasy/speakeasy.js` | `LEMONSQUEEZY_CHECKOUT_URL` | Set to the live checkout URL before enabling the paywall (`HARD_MODE_PAYWALL_ENABLED = true`). |
| `speakeasy/speakeasy.js` | `LEMONSQUEEZY_PRODUCT_ID` | Numeric product ID from the Lemon Squeezy dashboard. |

The Netlify proxy (`netlify/functions/ls-validate.js`) requires no secrets —
the Lemon Squeezy `/v1/licenses/validate` endpoint is public.

---

## Feature flags

Defined at the top of `speakeasy/speakeasy.js`:

| Flag | Default | Effect |
|---|---|---|
| `HARD_MODE_PAYWALL_ENABLED` | `false` | When `false`, After Hours is free to all users who have solved the daily. Set to `true` to enable the trial + Lemon Squeezy unlock flow. |
| `SUPPORT_ENABLED` | `false` | Shows a tip-jar link in Settings. Set `SUPPORT_URL` and `SUPPORT_LABEL` too. |

---

## Deployment

Deployment is automatic via **Netlify**:

1. Push to `main` → Netlify builds and deploys (publish directory: `.`).
2. The `netlify.toml` file wires `/api/ls/validate` → the serverless function.
3. No build command is required (static site).

To deploy from scratch:

1. Import the repo into Netlify.
2. Set publish directory to `.` and leave the build command blank.
3. No environment variables are required in the Netlify dashboard for current
   production settings.

---

## Database (Supabase)

Players, streaks, and solve history are stored in a Supabase project at
`fimsbfcvavpehryvvcho.supabase.co`.

Schema migrations are managed through the **Supabase dashboard** (no migration
files are committed). If you need to apply a schema change:

1. Open the Supabase SQL editor.
2. Run the migration SQL.
3. Update RLS policies if new tables are added.

Key tables:

| Table | Purpose |
|---|---|
| `players` | One row per device/user; holds streak and freeze count |
| `user_devices` | Maps auth user IDs to device IDs for cross-device sync |
| `daily_results` | Per-puzzle solve records (moves, time, operators used) |

Key RPC functions:

| Function | Called by |
|---|---|
| `get_or_create_player` | `syncFromSupabase` |
| `get_or_set_device_id` | `ensureCanonicalDeviceId` |
| `backfill_daily_results` | `backfillLocalHistoryToSupabase` |
| `update_player_streak` | `syncStreakToSupabase` |

---

## Feedback / support

Email: `martin@kapework.com`
