# Ma — Private Family App

A private, family-only web app for photo sharing, family updates, and shared calendar events.
Live at: **https://ma.kapework.com**

---

## What it is

- A warm, mobile-first SPA for a small family group
- Designed for easy use on iPhone, including by elderly family members
- Not linked from public Kapework pages — private by design
- Auth-gated: nothing visible before sign-in

---

## Architecture overview

| Layer       | Detail                                                       |
|-------------|--------------------------------------------------------------|
| Hosting     | Netlify static site, routed via the existing subdomain edge function |
| Auth        | Supabase Auth — magic link (primary), email + password (fallback); signup closed |
| Trusted device | Care recipient's read-only `/vandaag` display, auth'd by an HttpOnly cookie via same-origin Netlify Functions (no Supabase session on that device) |
| Database    | Supabase (PostgREST), tables prefixed `ma_`                  |
| Storage     | Supabase private bucket `ma-media`                           |
| Frontend    | Vanilla JS ES modules, no build step, imported from esm.sh   |

The subdomain router at `netlify/edge-functions/subdomain-router.ts` automatically maps
`ma.kapework.com/*` → `/apps/ma/*` — no router change is needed.

---

## File structure

```
apps/ma/
  index.html            App shell, loads styles.css + src/main.js
  styles.css            All styles (CSS custom properties, mobile-first)
  robots.txt            Disallow all (per-app; see notes below)
  _headers              X-Robots-Tag headers for Netlify
  README.md             This file

  vandaag/              Trusted read-only display (separate entry; no auth shell)
    index.html          /vandaag — display or six-digit-code pairing
    koppelen/index.html /vandaag/koppelen — one-tap link activation
    vandaag.css         Large, high-contrast styles
    manifest.webmanifest, icon.svg, sw.js   Installable PWA (static shell only)
    src/trusted.js      Display + pairing bootstrap (cookie-authed)

  src/
    main.js             Boot: session check → auth screen or app shell
    supabase.js         Supabase client (reads window.KapeworkConfig)
    state.js            Reactive state store (user, profile, familyId)
    router.js           Hash-based tab router (+ non-nav 'devices' route)
    api.js              All Supabase table queries
    storage.js          Photo upload + signed-URL helpers
    utils.js            escapeHtml, getInitial

    lib/
      datetime.js       Europe/Amsterdam date/time helpers (single source of truth)
      today-state.js    Deterministic "what now" engine (pure; unit-tested)
      event-derive.js   Conservative title/notes → safe derived fields
      devices-api.js    Client wrappers for the trusted-device Functions

    views/
      today.js          Today tab: Nu card + today's events + urgent notices + Vanavond
      briefing.js       Briefing tab: paste-ready Caren + WhatsApp texts
      family.js         Family tab: chronological feed + compose FAB
      photos.js         Photos tab: 3-column photo grid
      calendar.js       Calendar tab: read-only event agenda
      people.js         People tab: family member cards
      compose.js        Compose view: photo picker + caption + post
      devices.js        Apparaten: set up / list / revoke trusted devices

    components/
      topbar.js         Top app bar with menu (Apparaten / sign out)
      nav.js            Bottom tab bar (Today · Briefing · Family · Photos · Calendar · People)
      ride-notices.js   Ride-reconciliation strip
      post-card.js      Post display with async photo loading
      comment-list.js   Comment thread + reply input
      event-card.js     Calendar event card
      photo-grid.js     3-column photo grid with lazy loading
      modal.js          Full-screen photo lightbox
```

Trusted-device server code lives in `netlify/functions/` (`ma-pairing-create`,
`ma-device-activate`, `ma-today`, `ma-devices-list`, `ma-device-revoke`, plus
shared `_ma-crypto.js` / `_ma-devices.js` / `_ma-today-derive.js`).

---

## Running locally

There is no build step.  Open `apps/ma/index.html` directly, or serve with any static file server.

The app requires `window.KapeworkConfig` to be set with valid Supabase credentials.
In development, add a local override **before** the `src/main.js` script tag:

```html
<!-- local dev only — do NOT commit -->
<script>
  window.KapeworkConfig = {
    supabaseUrl:     'https://your-project.supabase.co',
    supabaseAnonKey: 'your-anon-key',
  };
</script>
```

Or run the Netlify CLI (`netlify dev`) with the env vars set in a local `.env` file.

---

## Environment variables (Netlify)

| Variable                     | Required | Scope        | Notes                                                        |
|------------------------------|----------|--------------|--------------------------------------------------------------|
| `SUPABASE_URL`               | Yes      | client + fn  | Supabase project URL                                         |
| `SUPABASE_ANON_KEY`          | Yes      | client       | Supabase public anon key (browser-safe)                     |
| `SUPABASE_SERVICE_ROLE_KEY`  | Yes      | **fn only**  | Service role; used by Netlify Functions. **Never** exposed to the browser. |
| `MA_DEVICE_TOKEN_PEPPER`     | Yes      | **fn only**  | Random server-only secret; peppers device-token/code hashes. Set as a Netlify **secret**. |
| `GA_MEASUREMENT_ID`          | No       | client       | Google Analytics — already used site-wide                   |

Only the three `client`-scoped values are written into `/shared/config.js` by
`scripts/generate-config.js` at build time (the app reads them via
`window.KapeworkConfig`). The `fn only` secrets are read solely from
`process.env` inside Netlify Functions and are **never** written to any client
bundle — verify by grepping `shared/config.js` after a build.

---

## Supabase schema

The following tables and objects must exist in the Supabase project:

### Tables

```sql
-- One record per family group
ma_families (
  id          uuid primary key,
  name        text,
  created_at  timestamptz default now()
)

-- Profile per auth user (user_id matches auth.users.id — this is the PK)
ma_profiles (
  user_id       uuid primary key references auth.users(id),
  display_name  text not null,
  relationship  text,    -- e.g. "Mum", "Son", "Daughter"
  avatar_url    text,
  created_at    timestamptz not null default now()
)

-- Many-to-many: auth users ↔ families (composite key, no surrogate id)
ma_family_members (
  family_id  uuid not null references ma_families(id),
  user_id    uuid not null references ma_profiles(user_id),
  role       text not null,
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
)

-- Family feed posts
ma_posts (
  id          uuid primary key,
  family_id   uuid references ma_families(id),
  author_id   uuid references ma_profiles(id),
  kind        text,        -- 'note' | 'photo'
  title       text,
  body        text,
  event_date  date,
  pinned      boolean default false,
  created_at  timestamptz default now()
)

-- Comments on posts
ma_comments (
  id         uuid primary key,
  post_id    uuid references ma_posts(id),
  author_id  uuid references ma_profiles(id),
  body       text not null,
  created_at timestamptz default now()
)

-- File/photo attachment metadata
ma_attachments (
  id            uuid primary key,
  post_id       uuid references ma_posts(id),
  family_id     uuid references ma_families(id),
  uploader_id   uuid references ma_profiles(user_id),
  object_path   text not null,    -- path in the ma-media bucket
  mime_type     text,
  created_at    timestamptz default now()
)

-- Calendar source records (one per synced calendar)
ma_calendar_sources (
  id                    uuid primary key,
  family_id             uuid references ma_families(id),
  label                 text,
  source_type           text,               -- e.g. 'ical'
  external_calendar_uid text,
  last_synced_at        timestamptz,
  created_at            timestamptz default now()
)

-- Mirrored read-only calendar events
-- Source of truth is the family iCloud calendar; events are synced externally
ma_calendar_events (
  id                 uuid primary key,
  family_id          uuid not null references ma_families(id),
  source_id          uuid references ma_calendar_sources(id),
  external_event_uid text not null,       -- opaque iCal UID (the mirror upserts on it)
  title              text not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz,
  all_day            boolean not null default false,
  location           text,
  notes              text,
  external_url       text,
  status             text not null,       -- iCal status, e.g. 'confirmed' | 'cancelled'
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
)

-- Generated daily briefing texts (see supabase-migrations/003_ma_briefings.sql)
-- Written only by the private irma-sync job (service role). Members read all
-- rows and flip status; the generated texts are immutable to members.
ma_briefings (
  id            uuid primary key,
  family_id     uuid references ma_families(id) on delete cascade,
  briefing_date date not null,
  caren_text    text,               -- Caren cluster line + WINDOW line
  whatsapp_text text,               -- WhatsApp evening reminder draft
  source_hash   text not null,      -- SHA-256 of the day's source clusters
  status        text not null,      -- 'ready' | 'sent' | 'changed_after_sent'
  sent_at       timestamptz,
  sent_by       uuid references ma_profiles(user_id),
  generated_at  timestamptz default now(),
  unique (family_id, briefing_date)
)

-- Ride-reconciliation notices (see supabase-migrations/004_ma_ride_notices.sql)
-- Written only by the private irma-sync job (service role): it reads forwarded
-- ride e-mails, compares them against ma_calendar_events, and records each
-- discrepancy (missing / conflict / cancellation / unparsed) for a human. This
-- feature never writes to the calendar. Members read open rows and may dismiss
-- them; every other column is immutable to members (BEFORE UPDATE guard trigger).
ma_ride_notices (
  id                 uuid primary key,
  family_id          uuid references ma_families(id) on delete cascade,
  source_message_id  text not null,
  thread_id          text,
  received_at        timestamptz not null,
  kind               text not null,     -- 'ride' | 'cancellation' | 'change' | 'unknown'
  ride_date          date,
  driver             text,
  pickup_time        time,
  return_time        time,
  destination        text,
  return_place       text,
  excerpt            text not null,     -- verbatim source sentence (shown to the human)
  confidence         text not null,     -- 'high' | 'low'
  match_status       text not null,     -- 'matched' | 'missing' | 'conflict' | 'unparsed'
  matched_event_uid  text,
  state              text not null,     -- 'open' | 'dismissed' | 'resolved'
  dismissed_by       uuid references ma_profiles(user_id),
  dismissed_at       timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (family_id, source_message_id, ride_date)
)
```

### RLS policies (minimum viable)

All tables should have RLS enabled.  At minimum:

- `ma_profiles`: users can read/update their own row
- `ma_family_members`: members can read rows where `family_id` matches their family
- `ma_posts`, `ma_comments`, `ma_attachments`: members can read/insert where `family_id` matches
- `ma_calendar_events`, `ma_calendar_sources`: read-only for family members
- `ma_briefings`: members read all family rows and may update only the status /
  sent fields; inserts and text edits are service-role-only (see migration 003)
- `ma_ride_notices`: members read all family rows and may update only the
  dismissal fields (`state` / `dismissed_by` / `dismissed_at`); inserts and every
  other column are service-role-only (see migration 004)
- `ma_trusted_devices`, `ma_device_pairings`: **default-deny** — RLS enabled with
  no policies, and table grants revoked from `anon`/`authenticated`. Browsers get
  no direct access; all reads/writes go through service-role Netlify Functions that
  verify membership first (see migration 005)
- `ma_families`: read for members

### Storage bucket

Create a **private** bucket named `ma-media` in Supabase Storage.
Objects are accessed via time-limited signed URLs generated by the app.

```
Bucket:  ma-media
Policy:  authenticated users in the family can upload/download
         (implement via storage RLS or a Supabase function)
```

---

## Deploying at ma.kapework.com

1. **Netlify domain alias** — add `ma.kapework.com` as a domain alias in the Netlify site settings
2. **DNS** — add a CNAME record `ma → <netlify-site>.netlify.app` in the Kapework DNS config
3. **Supabase URL allowlist** — add `https://ma.kapework.com` to the list of allowed redirect URLs in Supabase Auth settings
4. **Environment variables** — ensure `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `MA_DEVICE_TOKEN_PEPPER` are set in Netlify
   (mark the last two as **secrets**; they are Functions-only).
5. **Migrations** — apply DB migrations **before** the deploy that ships code
   depending on them, in order. Trusted devices need `005_ma_trusted_devices.sql`.

The subdomain edge function (`netlify/edge-functions/subdomain-router.ts`) will automatically
route `ma.kapework.com/*` → `/apps/ma/*` (including `/vandaag` and
`/.netlify/functions/*`) with no code changes required.

---

## Privacy / noindex

- `<meta name="robots" content="noindex, nofollow">` in `index.html`
- `X-Robots-Tag: noindex, nofollow` header in `_headers`
- `robots.txt` with `Disallow: /`

Note: The edge router passes `/robots.txt` through to the root `robots.txt`.
The meta tag and `X-Robots-Tag` header are the primary defences for this app's noindex requirement.

---

## Calendar sync

The app reads `ma_calendar_events` as a **read-only mirror**.
Calendar editing happens entirely in Apple Calendar.
To keep events current, set up a separate sync process (e.g. a Supabase edge function or
cron job) that reads the family iCloud calendar's public ICS feed and upserts into
`ma_calendar_events`.  This is outside the scope of this app.

---

## Trusted devices — the care recipient's `/vandaag` display

`ma.kapework.com/vandaag` is a **separate, read-only** entry point (its own
`apps/ma/vandaag/index.html`; it never loads the family app or Supabase Auth). It
shows only a server-built, sanitized snapshot of *today in Europe/Amsterdam* — no
posts, attachments, ride excerpts, notes, external URLs, profiles, emails, or
briefing management. A device is enrolled once and then needs no sign-in.

**Security model**

- The device credential is a long-lived, revocable **HttpOnly + Secure +
  SameSite=Strict** same-origin cookie (`ma_today_device`). JavaScript can never
  read it. Only `SHA-256(token + MA_DEVICE_TOKEN_PEPPER)` is stored in the DB.
- All device endpoints are same-origin Netlify Functions (reachable at
  `ma.kapework.com/.netlify/functions/*` — the edge router passes `/.netlify/`
  through). They use the service-role key; the two device tables are RLS
  default-deny to browsers.
- Nothing here can write to the calendar; the payload is strictly read-only.

**Endpoints** (`netlify/functions/`)

| Function | Auth | Purpose |
|----------|------|---------|
| `ma-pairing-create` | family member (Bearer) | Mint a one-time link + 6-digit code (15-min expiry). Returns raw secrets **once**. |
| `ma-device-activate` | pairing token/code | Consume a pairing atomically, mint a device token, set the cookie. |
| `ma-today` | device cookie | Sanitized today payload (`Cache-Control: no-store`). |
| `ma-devices-list` | family member (Bearer) | List devices (no hashes). |
| `ma-device-revoke` | family member (Bearer) | Revoke a device; effective on its next refresh. |

**Setup (family side):** top-bar menu → **Apparaten** → *Nieuw apparaat instellen*
→ share the link (`Deel link`) or dictate the six-digit code. On the device, open
the link or visit `/vandaag` and type the code.

**Revocation & recovery**

- Revoke any device in one tap from **Apparaten**; the display loses access on its
  next 60-second refresh.
- Lost/cleared device? Just create a new pairing — the old token is never revealed
  or recoverable (only its hash is stored). Cleanup of expired/consumed rows is
  handled by `ma_cleanup_device_rows()` (run on a schedule; not required for normal
  operation).

---

## Accounts

Signup is **closed**: sign-in only works for accounts an admin has pre-created.
For each family member, provision (real addresses live only in the Supabase
dashboard and Netlify config — never in this public repo):

1. A Supabase Auth user (their email address).
2. A matching `ma_profiles` row (created automatically on first sign-in, or by hand).
3. An `ma_family_members` row linking that `user_id` to the family.

Sign-in is passwordless by default (magic link); email + password remains as a
demoted fallback.

The care recipient does **not** get an account — their device is paired instead
(see “Trusted devices”, below).

---

## Shortcuts

| Task                  | How                                                  |
|-----------------------|------------------------------------------------------|
| Run locally           | `netlify dev` or any static server at `apps/ma/`     |
| Deploy                | Push to `main` → Netlify auto-deploys                |
| Add env vars          | Netlify → Site settings → Environment variables      |
| Apply DB migrations   | Supabase dashboard → SQL editor, or `supabase db push` |
| Run tests             | `npm test` (state engine + device crypto/derive)    |
| State engine × TZ     | `npm run test:today-state` (UTC/NY/Amsterdam/Jakarta) |
| Manual acceptance     | See `apps/ma/TRUSTED_DEVICES.md`                     |
| Check errors          | Browser console; errors logged with `[ma/...]` prefix |
