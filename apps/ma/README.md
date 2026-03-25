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
| Auth        | Supabase Auth (email + password)                             |
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

  src/
    main.js             Boot: session check → auth screen or app shell
    supabase.js         Supabase client (reads window.KapeworkConfig)
    state.js            Reactive state store (user, profile, familyId)
    router.js           Hash-based tab router
    api.js              All Supabase table queries
    storage.js          Photo upload + signed-URL helpers
    utils.js            Date formatting, escapeHtml, getInitial

    views/
      today.js          Today tab: greeting, recent posts, upcoming events
      family.js         Family tab: chronological feed + compose FAB
      photos.js         Photos tab: 3-column photo grid
      calendar.js       Calendar tab: read-only event agenda
      people.js         People tab: family member cards
      compose.js        Compose view: photo picker + caption + post

    components/
      topbar.js         Top app bar with menu / sign out
      nav.js            Bottom tab bar (Today · Family · Photos · Calendar · People)
      post-card.js      Post display with async photo loading
      comment-list.js   Comment thread + reply input
      event-card.js     Calendar event card
      photo-grid.js     3-column photo grid with lazy loading
      modal.js          Full-screen photo lightbox
```

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

| Variable             | Required | Notes                                      |
|----------------------|----------|--------------------------------------------|
| `SUPABASE_URL`       | Yes      | Supabase project URL                       |
| `SUPABASE_ANON_KEY`  | Yes      | Supabase public anon key (browser-safe)    |
| `GA_MEASUREMENT_ID`  | No       | Google Analytics — already used site-wide  |

These are written into `/shared/config.js` by `scripts/generate-config.js` at build time.
The Ma app reads them via `window.KapeworkConfig` (loaded from `/shared/config.js`).

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

-- Profile per auth user (id matches auth.users.id)
ma_profiles (
  id            uuid primary key references auth.users(id),
  display_name  text,
  relationship  text,    -- e.g. "Mum", "Son", "Daughter"
  avatar_url    text,
  created_at    timestamptz default now()
)

-- Many-to-many: auth users ↔ families
ma_family_members (
  id         uuid primary key,
  family_id  uuid references ma_families(id),
  user_id    uuid references ma_profiles(id),
  role       text,
  joined_at  timestamptz default now()
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
  storage_path  text not null,    -- path in the ma-media bucket
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
  family_id          uuid references ma_families(id),
  source_id          uuid references ma_calendar_sources(id),
  external_event_uid text,
  title              text not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz,
  all_day            boolean default false,
  location           text,
  notes              text,
  external_url       text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
)
```

### RLS policies (minimum viable)

All tables should have RLS enabled.  At minimum:

- `ma_profiles`: users can read/update their own row
- `ma_family_members`: members can read rows where `family_id` matches their family
- `ma_posts`, `ma_comments`, `ma_attachments`: members can read/insert where `family_id` matches
- `ma_calendar_events`, `ma_calendar_sources`: read-only for family members
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
4. **Environment variables** — ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in Netlify site environment settings (they are likely already set for the main Kapework site)

The subdomain edge function (`netlify/edge-functions/subdomain-router.ts`) will automatically
route `ma.kapework.com/*` → `/apps/ma/*` with no code changes required.

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

## Accounts

The following email addresses should be provisioned as Supabase Auth users and added
as `ma_family_members` with corresponding `ma_profiles`:

- irma.tobing@gmail.com
- mltobing@gmail.com
- loemban@gmail.com
- john@gmail.com

---

## Shortcuts

| Task                  | How                                                  |
|-----------------------|------------------------------------------------------|
| Run locally           | `netlify dev` or any static server at `apps/ma/`     |
| Deploy                | Push to `main` → Netlify auto-deploys                |
| Add env vars          | Netlify → Site settings → Environment variables      |
| Apply DB migrations   | Supabase dashboard → SQL editor, or `supabase db push` |
| Check errors          | Browser console; errors logged with `[ma/...]` prefix |
