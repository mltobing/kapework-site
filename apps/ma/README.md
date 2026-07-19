# Ma — Private Family App

A private, family-only web app for photo sharing, family updates, and shared calendar events —
plus a **Logboek** (logbook) that a family can optionally share with an active care team.
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
      logboek-types.js  Entry-type / audience labels, icons, and filter chip definitions

    views/
      today.js          Today tab: Nu card + today's events + urgent notices + Vanavond
                         + quick "Notitie of foto toevoegen" action. Caregivers get a
                         reduced Today (no calendar — see "Follow-up risks" below).
      briefing.js       Briefing tab: paste-ready Caren + WhatsApp texts (family only)
      logboek.js        Logboek tab: chronological, filterable timeline + compose FAB
      calendar.js       Calendar tab: read-only event agenda (family only)
      people.js         People tab: family member cards (family only)
      compose.js        Logboek compose flow: type, title, body, date, photos/PDF,
                         tags, linked event (family only), visibility
      devices.js        Apparaten: set up / list / revoke trusted devices (family only)

    components/
      topbar.js         Top app bar with menu (Apparaten hidden for caregivers / sign out)
      nav.js             Bottom tab bar — family: Vandaag · Briefing · Logboek · Agenda · Mensen;
                         caregiver: Vandaag · Logboek only
      ride-notices.js   Ride-reconciliation strip
      logboek-entry.js  Entry card: type/audience badges, photos, documents, tags, comments
      logboek-comments.js Comment thread + reply input (Dutch)
      event-card.js     Calendar event card
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

-- Logboek entries (formerly "family feed posts" — see supabase-migrations/006_ma_logboek_care_team.sql)
ma_posts (
  id                uuid primary key,
  family_id         uuid references ma_families(id),
  author_id         uuid references ma_profiles(id),
  kind              text,        -- 'note' | 'photo' | 'document' | 'observation' | 'event_report'
                                  -- (plus pre-existing 'voice' | 'prompt' | 'today', kept valid but
                                  -- not author-selectable — see migration 006's comment)
  title             text,
  body              text,
  event_date        date,        -- the date the entry concerns, shown in the timeline
  audience          text not null default 'family',  -- 'family' | 'care_team' — see below
  tags              text[] not null default '{}',
  linked_event_uid  text,        -- optional ma_calendar_events.external_event_uid, no FK (mirrors
                                  -- the ma_ride_notices.matched_event_uid precedent)
  pinned            boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz not null default now()  -- kept current by a BEFORE UPDATE trigger
)

-- Care-team membership — deliberately a SEPARATE table from ma_family_members so
-- existing family RLS (built on ma_is_family_member) can never accidentally widen
-- to include care-team users.
ma_care_team_members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references ma_families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,  -- null = active; set = revoked (checked by ma_is_care_team_member)
  unique (family_id, user_id)
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

- `ma_profiles`: users can read/update their own row; can also read another
  user's profile if they share a family context — either directly (both in
  `ma_family_members` for the same family) or via `ma_care_team_members`
  (family ↔ active caregiver, or two active caregivers of the same family).
  That cross-table lookup runs through the `ma_shares_family_context()`
  SECURITY DEFINER helper, never a bare subquery — a caregiver has no RLS
  grant into `ma_family_members` at all, so a direct subquery there is
  silently blocked before it ever compares rows (this bit a first draft of
  migration 006; fixed same-day, see the migration's comments).
- `ma_family_members`: members can read rows where `family_id` matches their family
- `ma_care_team_members`: a user can read their own membership row; a family
  member can read the full roster for their family. No insert/update/delete
  policy — provisioning is a manual step (see "Care team" below).
- `ma_posts`, `ma_comments`, `ma_attachments`: see the audience matrix below
- `ma_calendar_events`, `ma_calendar_sources`: read-only for family members
  (not extended to care team in this PR — see "Follow-up risks")
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

### Logboek — audience & the care team

Every `ma_posts` row (a "Logboek entry") carries an `audience`:

| Value       | Who can read it                                          |
|-------------|------------------------------------------------------------|
| `family`    | Family owner/member only (the safe default for new entries) |
| `care_team` | Family owner/member **and** active care-team users for that family |

`ma_comments` and `ma_attachments` have no `audience` column of their own —
access always resolves through a join back to the parent `ma_posts` row, so a
comment or attachment can never be *more* visible than its parent entry.

Care-team membership lives in `ma_care_team_members`, checked by the
`ma_is_care_team_member(family_id)` SECURITY DEFINER helper (fixed
`search_path`, active only while `revoked_at is null` — mirrors
`ma_is_family_member`/`ma_is_family_owner`). A care-team user is **never**
given a row in `ma_family_members`, so none of the existing family policies
accidentally widen to include them.

Authorization matrix (verified with live SQL RLS tests against synthetic
data — see "Tests" below):

| Actor | Read family entry | Read care_team entry | Create family entry | Create care_team entry | Edit/delete own | Edit/delete others' |
|---|---|---|---|---|---|---|
| Family owner | yes | yes | yes | yes | yes | yes (any family entry) |
| Family member | yes | yes | yes | yes | yes | no |
| Active caregiver | no | yes (own family only) | no | yes | yes (care_team only, can't retarget to `family`) | no |
| Revoked caregiver | no | no | no | no | no | no |
| Unrelated signed-in user | no | no | no | no | no | no |
| Anonymous | no | no | no | no | no | no |
| Trusted `/vandaag` device | no — has no Supabase session at all | | | | | |

### Care team — provisioning & revocation

Invitations are intentionally **not** self-service in this PR — a half-secure
client-side invite flow was judged out of scope (see "Follow-up risks"). An
admin provisions a caregiver by hand, in the Supabase SQL editor:

```sql
-- 1. Create the Supabase Auth user first (Dashboard → Authentication → Add user,
--    or supabase.auth.admin.createUser via the service role) — get their user_id.
-- 2. Grant care-team access for a family:
insert into ma_care_team_members (family_id, user_id, created_by)
values ('<family-uuid>', '<caregiver-auth-user-uuid>', '<admin-auth-user-uuid>');
```

The caregiver then signs in the same way family members do (magic link) — their
`ma_profiles` row is created automatically on first sign-in, same as anyone else.
No email/name goes in this repository or in fixtures.

To revoke, set `revoked_at` — access is checked live on every query, so it takes
effect immediately (no cached session to invalidate, no signed URL stays valid
past its own short TTL):

```sql
update ma_care_team_members
   set revoked_at = now()
 where family_id = '<family-uuid>' and user_id = '<caregiver-auth-user-uuid>';
```

### Storage bucket

Create a **private** bucket named `ma-media` in Supabase Storage.
Objects are accessed via time-limited (15-minute) signed URLs generated by the app —
short-lived because Logboek attachments can include care observations and
appointment documents, not just holiday photos; re-signed fresh on every
render rather than cached.

```
Bucket:  ma-media
Path:    <family_id>/<post_id>/<random-uuid>.<ext>
Policy:  family members can read/upload/update/delete under their family's
         path prefix (path-based is equivalent to post-visibility for them,
         since family sees every entry in their family regardless of audience).
         Active caregivers can read/upload/delete only under a care_team post
         — resolved by joining the path's post_id back to ma_posts, so a
         guessed object path cannot bypass a post's audience the way a bare
         family-path check would.
```

Client-side upload limits (also enforced by the bucket's own
`allowed_mime_types`/`file_size_limit`): images (jpeg/png/gif/webp/heic) or a
single PDF, max 15 MB per file — see `apps/ma/src/storage.js`. Object names use
`crypto.randomUUID()`, never a timestamp alone.

---

## Deploying at ma.kapework.com

1. **Netlify domain alias** — add `ma.kapework.com` as a domain alias in the Netlify site settings
2. **DNS** — add a CNAME record `ma → <netlify-site>.netlify.app` in the Kapework DNS config
3. **Supabase URL allowlist** — add `https://ma.kapework.com` to the list of allowed redirect URLs in Supabase Auth settings
4. **Environment variables** — ensure `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and `MA_DEVICE_TOKEN_PEPPER` are set in Netlify
   (mark the last two as **secrets**; they are Functions-only).
5. **Migrations** — apply DB migrations **before** the deploy that ships code
   depending on them, in order. Trusted devices need `005_ma_trusted_devices.sql`;
   Logboek + care team need `006_ma_logboek_care_team.sql` applied on top of it.
   (As of this PR both have been applied to the live project — `005` had been
   merged into `main` but never actually applied, which was caught and fixed
   as part of shipping `006`; see "Follow-up risks".)

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

This separation is structural, not just a UI choice: `apps/ma/vandaag/src/trusted.js`
imports only `lib/today-state.js`, `lib/datetime.js`, and `utils.js` — it has
never imported anything Logboek-related, has no Supabase client of its own, and
never will, since it authenticates via an HttpOnly cookie against Netlify
Functions, not a Supabase session. Logboek entries (of either audience) never
reach this route.

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

A **caregiver** (active care-team member) is a normal Supabase Auth user who
signs in the same way, but is granted access via `ma_care_team_members`
instead of `ma_family_members` — see "Care team — provisioning & revocation"
above. The app resolves `accessType` (`owner` | `member` | `caregiver`) once
at sign-in from those two tables (`fetchAccessContext` in `src/api.js`) and
never infers it from the UI or an email address. A caregiver gets a
deliberately reduced app: **Vandaag · Logboek** only — no Briefing, Agenda,
Mensen, or Apparaten (device management), and Logboek shows only
`care_team`-audience entries. This is enforced twice, independently: the
route itself doesn't exist for a caregiver (`main.js`'s `CAREGIVER_ALLOWED_ROUTES`
guard, even against a hand-typed hash), and the underlying data is RLS-gated
regardless of what the UI shows.

---

## Logboek — follow-up risks

Deliberately deferred out of this PR's scope, tracked here rather than shipped
as a half-finished feature:

- **Care-team Agenda access.** The brief's suggested caregiver nav included
  Agenda, but `ma_calendar_events` has no care-team RLS policy in this PR —
  calendar entries can carry travel/administrative detail the brief also lists
  as something a caregiver must never see, so extending read access needs its
  own deliberate design (e.g. a filtered view of only care-relevant
  appointments) rather than a blanket grant. A caregiver's Today/Logboek work
  fully without it; they simply see no Agenda tab right now.
- **Self-service care-team invitations.** Provisioning is a manual SQL step
  (see above) by design — a secure invite flow (token generation, expiry,
  claim endpoint) is a real feature in its own right and was judged out of
  scope rather than shipped half-secure.
- **One orphaned `storage.objects` test row.** The RLS test run below inserted
  synthetic rows directly via SQL (including one `storage.objects` metadata
  row) to exercise Storage policies without touching real family data.
  Everything else was cleaned up in the same session; that one row couldn't be,
  because Supabase's `storage.protect_delete()` trigger blocks direct SQL
  deletes on `storage.objects` (by design, to prevent orphaning real files) —
  it has to go through the Storage API instead. The row is inert: it points at
  a family/post that no longer exists, so no current RLS policy can match it
  for any real user. Safe to delete via the Storage dashboard if you want a
  pristine bucket listing; harmless if left alone.

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
| Logboek RLS tests     | No repo script (SQL run directly against the live project via Supabase MCP, using synthetic families/users wrapped in transactions/cleanup — see the PR description for the full authorization-matrix results) |
| Manual acceptance     | See `apps/ma/TRUSTED_DEVICES.md`                     |
| Check errors          | Browser console; errors logged with `[ma/...]` prefix |
