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
      datetime.js           Europe/Amsterdam date/time helpers (single source of truth)
      today-state.js        Deterministic "what now" engine (pure; unit-tested)
      event-derive.js       Conservative title/notes → safe derived fields
      devices-api.js        Client wrappers for the trusted-device Functions
      logboek-types.js      Entry-type / audience labels, icons, and filter chip definitions
      admin-activity.js     Beheer: action→Dutch-sentence/icon/actor/bucket mapping (pure; unit-tested)
      beheer-health.js      Beheer: Systeemstatus green/amber/red/neutral rules, incl. a
                             "running" state for an in-progress sync (pure; unit-tested)
      presence-heartbeat.js Beheer: dependency-injected presence-touch scheduler (pure; unit-tested)
      sync-api.js            Client wrapper for the owner-only manual-sync-request Function

    views/
      today.js          Today tab: Nu card + today's events + urgent notices + Vanavond
                         + quick "Notitie of foto toevoegen" action. Caregivers get a
                         reduced Today (no calendar — see "Follow-up risks" below).
      briefing.js       Briefing tab: paste-ready Caren + WhatsApp texts (family/member only)
      logboek.js        Logboek tab: chronological, filterable timeline (search, author,
                         date-range filters) + compose FAB. Author edit/trash and owner
                         trash-any live in an entry's overflow menu — see "Logboek" below.
      calendar.js       Calendar tab: read-only event agenda (family/member only) + a
                         small "Laatst bijgewerkt" freshness line for every viewer
      beheer.js         Beheer tab: Systeemstatus (incl. Agenda-synchronisatie's
                         owner-only manual refresh), Recente activiteit, Mensen en
                         toegang, Apparaten summary, Prullenbak summary (owner only)
      prullenbak.js     Beheer → Prullenbak: owner-only trashed-Logboek-entry
                         management (Herstellen / Definitief verwijderen)
      uitleg.js         /uitleg — static "Uitleg & veelgestelde vragen" help page,
                         reachable from the top-right menu, no private data
      compose.js        Logboek compose flow: type, title, body, date, photos/PDF,
                         tags, linked event (family only), visibility
      devices.js        Apparaten: set up / list / revoke trusted devices (owner only)

    components/
      topbar.js         Top app bar with a three-section menu — Ga naar (every
                         destination the signed-in accessType can reach, mirroring
                         nav.js's TABS_BY_ACCESS), Hulp (Uitleg), Account (Apparaten
                         owner-only, Uitloggen)
      nav.js            Bottom tab bar — owner: Vandaag · Briefing · Logboek · Agenda · Beheer;
                         member: Vandaag · Briefing · Logboek · Agenda (no Beheer);
                         caregiver: Vandaag · Logboek only. Exports TABS_BY_ACCESS,
                         reused by topbar.js so the two never drift apart.
      ride-notices.js   Ride-reconciliation strip
      logboek-entry.js  Entry card: type/audience badges, photos, documents, tags,
                         comments, and (for an eligible viewer) a compact "⋯"
                         overflow menu — Bewerken (own entry only) / Verwijderen
                         (own entry, or any entry for the owner)
      logboek-comments.js Comment thread + reply input (Dutch)
      logboek-edit-modal.js "Bewerken" — a focused modal for title/body/date/tags
      toast.js          A temporary snackbar with one optional action button —
                         backs the Logboek "moved to trash, Ongedaan maken" undo
      event-card.js     Calendar event card
      modal.js          Full-screen photo lightbox
```

Trusted-device server code lives in `netlify/functions/` (`ma-pairing-create`,
`ma-device-activate`, `ma-today`, `ma-devices-list`, `ma-device-revoke`, plus
shared `_ma-crypto.js` / `_ma-devices.js` / `_ma-today-derive.js` /
`_ma-activity.js` — the last records Beheer activity events from the
device-activation/revocation endpoints). `ma-sync-trigger` (owner-only manual
calendar refresh) lives alongside them and reuses the same `_ma-devices.js`
`verifyOwner()`/`serviceClient()` helpers — see "Agenda-synchronisatie —
manual refresh" below.

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
| `GA_MEASUREMENT_ID`          | No       | client       | Google Analytics — used by other Kapework apps; **Ma deliberately never loads `/shared/analytics.js`, so this has no effect here** (see "Why no Google Analytics?" below) |

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
  updated_at        timestamptz not null default now(), -- kept current by a BEFORE UPDATE trigger
  updated_by        uuid references ma_profiles(user_id),  -- set by editLogboekEntry-style edits
  deleted_at        timestamptz,   -- null = active; set = soft-deleted ("Prullenbak" — see below)
  deleted_by        uuid references ma_profiles(user_id)
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
  revoked_by  uuid references auth.users(id),  -- who revoked it — added in migration 007, for the
                                                -- Beheer activity trail's "caregiver_access_revoked" event
  updated_at  timestamptz not null default now(),  -- kept current by a BEFORE UPDATE trigger
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

-- One row per private irma-sync pipeline execution (see supabase-migrations/007_ma_admin_dashboard.sql).
-- Written only by the service-role sync job. Backs the Beheer "Systeemstatus" cards.
ma_integration_runs (
  id                       uuid primary key default gen_random_uuid(),
  family_id                uuid not null references ma_families(id) on delete cascade,
  run_key                  text not null,
  started_at               timestamptz not null,
  finished_at              timestamptz,
  status                   text not null default 'running',        -- running|success|partial|failed
  calendar_status          text not null default 'pending',        -- pending|success|failed|skipped
  briefing_status          text not null default 'pending',        -- pending|success|failed|skipped
  notices_status           text not null default 'pending',        -- pending|success|failed|disabled|misconfigured|skipped
  events_seen              integer not null default 0,   -- + events_created/updated/unchanged/cancelled
  briefings_updated        integer not null default 0,   -- + briefings_unchanged/briefings_failed
  mail_messages_seen       integer not null default 0,   -- + mail_extract_calls/notice_rows_written/
                                                           --   notices_superseded/notices_auto_resolved/
                                                           --   mail_parse_failures/mail_dropped_non_ride/
                                                           --   mail_dropped_no_excerpt
  error_stage              text,
  created_at               timestamptz not null default now(),
  trigger_source           text not null default 'schedule',  -- 'schedule' | 'manual'
  triggered_by_request_id  uuid references ma_sync_requests(id),  -- set once the job
                            -- correlates a run to a manual request — see below
  unique (family_id, run_key)
)

-- One row per owner-initiated "run the sync now" request (migration 009,
-- extended by migration 010 with dispatch-status fields). Written only by
-- the ma-sync-trigger Netlify Function (service role); no browser
-- INSERT/UPDATE/DELETE policy at all. ma-sync-trigger.js dispatches the
-- private irma-sync workflow directly via the GitHub API right after
-- inserting this row — see "Agenda-synchronisatie — manual refresh" below.
ma_sync_requests (
  id                     uuid primary key default gen_random_uuid(),
  family_id              uuid not null references ma_families(id) on delete cascade,
  requested_by           uuid not null references ma_profiles(user_id),
  requested_at           timestamptz not null default now(),
  claimed_at             timestamptz,               -- set by the job's ma_claim_sync_request() RPC
  run_id                 uuid references ma_integration_runs(id),  -- set by the job once known
  dispatch_status        text not null default 'pending',  -- 'pending' | 'dispatched' | 'failed'
  dispatch_attempted_at  timestamptz,
  dispatched_at          timestamptz,               -- set only on a successful GitHub dispatch
  dispatch_error_code    text,   -- 'config_error'|'network_error'|'github_client_error'|'github_server_error'
  github_run_id          text,  -- optional GitHub Actions run id, only when GitHub's 200 response includes one
  created_at             timestamptz not null default now()
)

-- Append-only owner-visible activity timeline. Single write path is
-- ma_record_activity_event() (SECURITY DEFINER, EXECUTE revoked from every
-- browser role) — never a direct browser insert. See "Beheer" below for the
-- full privacy contract (what may and may never appear in `metadata`).
ma_activity_events (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references ma_families(id) on delete cascade,
  occurred_at        timestamptz not null default now(),
  actor_type         text not null,        -- 'user' | 'system'
  actor_user_id      uuid references ma_profiles(user_id) on delete set null,
  source             text not null,        -- 'database' | 'app' | 'trusted_device' | 'irma_sync'
  action             text not null,        -- e.g. 'logboek_created', 'trusted_device_revoked'
  object_type        text,
  object_id          uuid,
  severity           text not null default 'info',   -- 'info' | 'attention' | 'error'
  metadata           jsonb not null default '{}'::jsonb,  -- counts/dates/statuses/labels/opaque ids only
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  unique (family_id, idempotency_key)  -- partial: only where idempotency_key is not null
)

-- Compact "last active" signal for the roster — a single upserted row per
-- (family, user), NOT an event stream. Written only via ma_touch_presence().
ma_user_presence (
  family_id    uuid not null references ma_families(id) on delete cascade,
  user_id      uuid not null references ma_profiles(user_id) on delete cascade,
  last_seen_at timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (family_id, user_id)
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
- `ma_posts`, `ma_comments`, `ma_attachments`: see the audience matrix below.
  As of migration 008, a trashed row (`deleted_at is not null`) is readable
  only by the family owner — a plain member/caregiver's SELECT never returns
  it, not just "the UI hides it." Trash/restore/permanent-delete go through
  three narrowly-scoped SECURITY DEFINER RPCs (`ma_trash_logboek_entry()`,
  `ma_restore_logboek_entry()`, `ma_permanently_delete_logboek_entry()`),
  each re-checking author-or-owner internally, rather than a raw
  `.update()`/`.delete()` against a table policy — see the migration's
  header comment for why a plain client UPDATE can't do this for a
  non-owner author (PostgreSQL requires the row to still satisfy the
  table's SELECT policy immediately after the write, even with no
  `.select()` chained, which the owner-only-trash policy would deny).
  Editing ordinary content (title/body/date/tags) is unaffected — that
  still goes through a plain `.update()`, since it never touches
  `deleted_at`.
- `ma_sync_requests`: owner-only SELECT, no browser INSERT/UPDATE/DELETE
  policy — written only by the `ma-sync-trigger` Netlify Function (service
  role), mirroring `ma_integration_runs`/`ma_activity_events`.
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
  verify **ownership**, not just membership, first (see migration 005 and "Trusted
  devices" below — this tightened from member to owner-only in migration 007)
- `ma_integration_runs`, `ma_activity_events`, `ma_user_presence`: **owner-only
  SELECT**, no browser INSERT/UPDATE/DELETE policy at all (grants revoked from
  `anon`/`authenticated`). Writes go only through `ma_record_activity_event()`
  and `ma_touch_presence()` (both SECURITY DEFINER, narrowly scoped — see
  "Beheer" below) or the service-role sync job. A family member, active
  caregiver, or unrelated user gets an empty result, never an error and never
  another family's data — see the RLS matrix under "Beheer" below.
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

### Logboek — edit, trash & search

An entry's own author may edit its text (title/body/date/tags — never
attachments, kind, or audience in this UI) and move it to the trash
("Verwijderen" in the compact "⋯" overflow menu on `components/logboek-entry.js`).
The family owner may additionally trash — but not edit — any entry, and is the
only one who can restore a trashed entry or permanently delete it, from
Beheer → Prullenbak (`views/prullenbak.js`).

**Soft delete.** Trashing sets `deleted_at`/`deleted_by` rather than removing
the row. The Logboek feed shows a temporary "Ongedaan maken" toast right
after deleting (`components/toast.js`) which restores it in place; once that
toast is gone, only an owner can bring it back, from Prullenbak, for about 30
days (`ma_cleanup_trashed_logboek_entries()`, not wired to any cron in this
repo — run it from a scheduled job the same way as `ma_cleanup_device_rows()`,
see migration 005).

**Why three RPCs instead of a plain `.update()`/`.delete()`.** This tripped
up the first draft of migration 008 in exactly the way migration 006's
`ma_shares_family_context()` comment warns about for a different table: a
non-owner author's own `UPDATE ... SET deleted_at = now()` was rejected
outright with "new row violates row-level security policy," not silently
hidden afterward as expected. PostgreSQL requires the *post-update* row to
still satisfy the table's SELECT policy for the executing role — even with no
`RETURNING`/`.select()` — and the owner-only-trash SELECT policy denies
exactly that for the row the author just trashed. `ma_trash_logboek_entry()`,
`ma_restore_logboek_entry()`, and `ma_permanently_delete_logboek_entry()`
(all SECURITY DEFINER, all re-checking author-or-owner internally before
touching the row) sidestep this the same way `ma_touch_presence()` already
does for a different problem — see migration 008 for the full write-up and
the live RLS verification transcript in this PR's description.

**Search & filters.** Free-text search (title/body via `ilike`), author, and
an `event_date` range, layered on top of the existing kind/audience chips —
`api.fetchLogboekEntries()`/`fetchLogboekAuthors()`. Deleted entries are
excluded from every one of these, both by an explicit `deleted_at is null`
filter in the query *and* independently by RLS.

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

To revoke, set both `revoked_at` **and** `revoked_by` — access is checked live
on every query, so it takes effect immediately (no cached session to
invalidate, no signed URL stays valid past its own short TTL). `revoked_by`
matters beyond bookkeeping: the `ma_care_team_members_activity_trg` trigger
(migration 007) reads it to decide whether the resulting Beheer activity row
is attributed to the admin who acted (`revoked_by` set) or logged as a
system event (`revoked_by` left null) — always set it for a manual revoke:

```sql
update ma_care_team_members
   set revoked_at = now(),
       revoked_by = '<admin-auth-user-uuid>'
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
   Logboek edit/trash and Beheer's manual sync request need
   `008_ma_logboek_trash.sql` and `009_ma_calendar_manual_sync.sql` on top of
   `007_ma_admin_dashboard.sql`.
   (As of this PR, all of 005–009 have been applied to the live project —
   `005` had been merged into `main` but never actually applied, which was
   caught and fixed as part of shipping `006`; see "Follow-up risks". `008`
   was applied once, found to reject a non-owner author's own soft-delete
   due to a PostgreSQL RLS/UPDATE interaction, and corrected in place with a
   follow-up RPC-adding statement before this PR was opened — see the
   migration's own header comment.)

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

### Why no Google Analytics?

Every other Kapework app loads `/shared/analytics.js`. Ma deliberately does
not, and never has — none of its HTML entry points (`index.html`,
`vandaag/index.html`, `vandaag/koppelen/index.html`) reference it, and no app
source file imports `KapeworkAnalytics` or a `gtag`/Google Tag Manager
snippet. This is enforced by a regression test
(`apps/ma/src/lib/no-analytics.test.mjs`, part of `npm test`) so it can't
regress silently.

The reason is what Ma's data actually is: a record of who did what around the
daily care of a specific, named, vulnerable person. Route views, session
counts, and event props are exactly the kind of general-purpose analytics
signal a third-party product is built to collect and retain — and exactly
the kind of signal that should never leave this app for a family caregiving
tool. The Beheer dashboard's own `ma_activity_events` audit trail (see
"Supabase schema" above) covers the one legitimate need — "is the pipeline
healthy, and who did what" — as a first-party, owner-only, RLS-gated table
that never records route views, scrolls, photo opens, or keystrokes. That is
a deliberate, permanent design decision, not a gap to fill in later.

---

## Calendar sync

The app reads `ma_calendar_events` as a **read-only mirror**. Calendar editing
happens entirely in Apple Calendar. The mirror itself is written by the
private `irma-sync` GitHub Actions job (a separate, private repository) that
reads the shared iCloud calendar "Met Irma" over CalDAV and upserts into
`ma_calendar_events` — every 3 hours automatically, or immediately when an
owner presses **Agenda nu bijwerken** in Beheer (see "Agenda-synchronisatie —
manual refresh" below). That job mirrors appointments up to **six calendar
months ahead**, while Caren/WhatsApp briefing text is only ever prepared for
the **next 21 days** — a far-future appointment shows up in the Agenda long
before it has (or needs) a briefing. The Agenda view (`views/calendar.js`)
fetches events in paginated pages bounded to that same six-month horizon
("Meer laden" loads further pages), rather than an unbounded lifetime
history; Today/Briefing/compose keep their own narrow, task-focused windows.

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
| `ma-pairing-create` | family **owner** (Bearer) | Mint a one-time link + 6-digit code (15-min expiry). Returns raw secrets **once**. |
| `ma-device-activate` | pairing token/code | Consume a pairing atomically, mint a device token, set the cookie. Records one `trusted_device_activated` activity event (see "Beheer" below). |
| `ma-today` | device cookie | Sanitized today payload (`Cache-Control: no-store`). |
| `ma-devices-list` | family **owner** (Bearer) | List devices (no hashes). |
| `ma-device-revoke` | family **owner** (Bearer) | Revoke a device; effective on its next refresh. Records one `trusted_device_revoked` activity event, and only on a first-time revoke — a repeat call against an already-revoked device is a silent no-op, not a second event. |

Device administration was tightened from **any family member** to
**owner-only** in migration 007 — `verifyOwner()` in
`netlify/functions/_ma-devices.js` now checks `role = 'owner'`, not just
family membership. This lines up trusted-device management with the same
owner-only bar as the rest of Beheer, since both control access to the care
recipient's daily schedule.

**Setup (owner side):** top-bar menu → **Beheer → Apparaten** (or the
Apparaten card's link) → *Nieuw apparaat instellen* → share the link (`Deel
link`) or dictate the six-digit code. On the device, open the link or visit
`/vandaag` and type the code.

**Revocation & recovery**

- Revoke any device in one tap from **Apparaten**; the display loses access on its
  next 60-second refresh.
- Lost/cleared device? Just create a new pairing — the old token is never revealed
  or recoverable (only its hash is stored). Cleanup of expired/consumed rows is
  handled by `ma_cleanup_device_rows()` (run on a schedule; not required for normal
  operation).
- Every activation/revocation is one append-only, owner-visible activity row
  (see "Beheer" below) — never the pairing code, link token, device token
  hash, cookie, or device label. Only an opaque device id.

---

## Beheer — the owner-only admin dashboard

**Beheer** replaced the previously-unused **Mensen** nav destination
(`src/views/people.js`, deleted) as an owner-only administrative dashboard
(`src/views/beheer.js`). It answers five questions for the family's
administrators, and nothing else:

1. **Werkt alles?** — is the private irma-sync pipeline (calendar sync,
   briefings, AutoMaatje ride-mail checks) healthy right now?
2. **Wat is er gebeurd?** — a privacy-safe, append-only activity timeline.
3. **Wie heeft wat gedaan?** — verified attribution (a real display name or
   a system-source label, never a guess).
4. **Wie heeft toegang?** — the full family + care-team roster in one place.
5. **Welke apparaten zijn gekoppeld?** — trusted-device status.

It is deliberately **not** a general analytics dashboard and **not** a
surveillance feed — see "Why no Google Analytics?" above. It never records
route views, scrolls, photo opens, or keystrokes; only the handful of
meaningful mutations listed below.

**Access:** `beheer`, `devices`, and `prullenbak` are `owner`-only routes
(`ROUTE_ACCESS` in `src/main.js`); a member or caregiver who hand-types the
hash is redirected before any data fetch runs, and every underlying query is
independently RLS-gated regardless of what the UI shows (see the matrix
below). `uitleg` is reachable by every signed-in `accessType` (it holds no
private data). The top-right menu's "Ga naar" section only ever lists routes
the current `accessType` can reach (`nav.js`'s `TABS_BY_ACCESS`, reused by
`topbar.js`) — Beheer never appears there for a non-owner, on top of the
route guard itself. The legacy `#people` hash still resolves — to `#beheer` for an
owner, `#today` for anyone else — so no old bookmark breaks.

### Systeemstatus

Three cards, each colour-coded **groen / oranje / rood / neutraal** by a pure
function in `src/lib/beheer-health.js` (`computeAgendaHealth`,
`computeBriefingHealth`, `computeNoticesHealth` — unit-tested in
`beheer-health.test.mjs` at exact Europe/Amsterdam boundaries, not the
device's local time):

| Card | Source | Rule (summary) |
|---|---|---|
| Agenda-synchronisatie | `ma_integration_runs` (latest run) + `ma_calendar_sources.last_synced_at` | **running** (neutral, "Bezig met bijwerken…") if the latest run has `status = 'running'` and no `finished_at`; else green ≤6h old; amber 6–12h; red >12h; red if the latest run reports `calendar_status = 'failed'` (amber instead if the source still looks fresh — the two disagreeing is itself worth flagging, not silently resolved either way) |
| Briefings | tomorrow's `ma_briefings` row | neutral before 17:00 with nothing yet; amber if still missing after 17:00; green once `sent`; amber if `ready` but not sent after 18:00; red if `changed_after_sent` |
| AutoMaatje | latest run's `notices_status` + open `ma_ride_notices` count | neutral if disabled/no data; red on `failed`/`misconfigured`; green if `success` with zero open discrepancies; amber if `success` with open discrepancies |

`ma_integration_runs` is written only by the private irma-sync job (out of
scope for this repo) — this dashboard only ever reads it, and (see below)
can only ever *ask* that job to run sooner, never invoke it directly. It is
the pipeline's **heartbeat**: every scheduled or manual run writes a row here
regardless of whether anything actually changed, which is what lets
Systeemstatus stay accurate even on a quiet run that produces no activity
item (see "Recente activiteit" below).

**Freshness fallback.** The Agenda card's "Laatst succesvol bijgewerkt" line
normally uses `ma_calendar_sources.last_synced_at` — the source timestamp is
authoritative whenever it exists. If that timestamp is unexpectedly
unavailable (e.g. a family has more than one `ma_calendar_sources` row and
the current one hasn't recorded a sync time), `agendaFreshnessAt()` in
`beheer-health.js` falls back to the latest run's own `finished_at`, but only
when that run's `calendar_status = 'success'` — a fallback that could never
mask a `failed` calendar stage. Source-selection queries (`fetchCalendarLastSyncedAt()`,
`fetchCalendarSourceAdminStatus()` in `api.js`) are also null-safe: a source
row with no `last_synced_at` yet is never picked over one that has actually
synced.

**Automatic vs. manual runs.** The card shows the latest **automatic**
(`trigger_source = 'schedule'`) and latest **manual** (`trigger_source =
'manual'`) run as two separate, persistent lines (`fetchLatestIntegrationRunByTrigger()`
in `api.js`), each hidden until that trigger type has run at least once. This
replaces one ambiguous "last synchronisation attempt" line that didn't say
whether the most recent attempt was the automatic cycle or an owner-pressed
manual refresh.

**Legacy note:** an older `ma_calendar_sync_runs` table predates
`ma_integration_runs` and is untouched by migration 007 — confirmed **empty**
on the live project before this migration was written. It is not the
contract Beheer reads from, is not dropped or renamed, and nothing here
depends on it. Left for a later cleanup PR.

**Agenda-synchronisatie — manual refresh.** The same card carries an
owner-only **"Agenda nu bijwerken"** button (`views/beheer.js`, backed by the
`ma-sync-trigger` Netlify Function and `lib/sync-api.js`). Pressing it now
**actually starts the private irma-sync workflow** — this used to only
record a request the job would pick up on its own schedule; it now dispatches
directly:

> `ma-sync-trigger` records the same owner-only, single-flight,
> 60-second-cooldown, fully audited row in `ma_sync_requests` it always has
> (migration 009) — and then, right after that insert, calls GitHub's
> `workflow_dispatch` REST API for `mltobing/irma-sync`'s `sync.yml`,
> passing the new row's id as the `manual_request_id` input. The private job
> validates that id, atomically claims it (`ma_claim_sync_request()`,
> migration 010 — a duplicate dispatch, a stale/already-claimed request, or
> one for another family all safely fall back to an ordinary unlinked run
> rather than blocking anything), and stamps the run it produces with
> `trigger_source = 'manual'` and `triggered_by_request_id`. **The pipeline
> this repo has never been able to run itself — CalDAV, Claude, Gmail — still
> runs entirely in that private repository**; this repo only ever asks
> GitHub to start it, never re-implements it (the "separate competing
> implementation" the original brief said not to build).
>
> A failed dispatch (GitHub rejects the call, or is unreachable) marks the
> request `dispatch_status = 'failed'` rather than leaving a request stuck
> `pending` for 20 minutes — the owner sees a plain retry message and the
> very next click tries again immediately, it is not blocked behind the
> usual "still fresh" dedup window. `ma_sync_requests.dispatch_status`
> distinguishes `pending` (inserted, not yet dispatched — should never be
> visible for long), `dispatched` (GitHub accepted it), and `failed`.
>
> The Beheer UI now polls by the exact request → run correlation instead of
> guessing from the newest timestamp: once `ma_sync_requests.run_id` appears
> (set by the job after it claims the request), Beheer polls that exact
> `ma_integration_runs` row for up to ~4 minutes. States shown along the way:
> "Synchronisatie gestart…" (dispatched, run not yet observed), "Agenda wordt
> bijgewerkt…" (the run has started), then a real outcome — "Agenda is
> bijgewerkt." on success, "Agenda is bijgewerkt, maar de
> AutoMaatje-controle vraagt aandacht." on a `partial` run (the calendar
> itself is fine; only the mail check needs a look), or "De synchronisatie is
> mislukt. Probeer het opnieuw." on `failed`. If nothing lands within the
> timeout: "De synchronisatie is gestart en loopt mogelijk nog. Kijk over
> enkele minuten opnieuw." — never a false negative for a run that's simply
> still queued on GitHub's runners.

Server-side: owner-only (`verifyOwner()`, reused from `_ma-devices.js`);
requires the fine-grained GitHub token/repo/workflow/ref to be configured at
all (fails safely with a generic 503 before writing anything if not); refuses
a duplicate request while a run is actively `running` (a run stuck in that
state for >20 minutes is treated as stale, not a permanent block); enforces
the 60-second cooldown against both the latest finished run and any
still-fresh, not-already-failed unclaimed request; records one
`manual_sync_requested` activity event per accepted request (empty metadata —
nothing about the calendar itself); never logs the GitHub token, the
Authorization header, or a GitHub response body. See
`netlify/functions/ma-sync-trigger.js` and
`netlify/functions-tests/ma-sync-trigger.test.js`.

**Configuration (server-only Netlify environment variables — never in the
browser bundle):**

| Variable | Required | Purpose |
|---|---|---|
| `MA_SYNC_GITHUB_TOKEN` | yes, secret | Fine-grained GitHub PAT, scoped to **only** `mltobing/irma-sync`, repository permission **Actions: Read and write**, **Metadata: Read-only** — no broader classic `repo` token. |
| `MA_SYNC_GITHUB_REPOSITORY` | no — defaults to `mltobing/irma-sync` | Target repository for the dispatch. |
| `MA_SYNC_GITHUB_WORKFLOW` | no — defaults to `sync.yml` | Workflow file to dispatch. |
| `MA_SYNC_GITHUB_REF` | no — defaults to `main` | Branch/ref the workflow dispatches from. |

Only the token is secret, but none of the four belongs in client-side code —
they're read only inside the Netlify Function. See the PR description for
exact steps to create the token and set these in the Netlify dashboard.

### Recente activiteit

A reverse-chronological feed of `ma_activity_events`, filterable by
**Alles / Familie / Zorgteam / Systeem**. Every row is rendered through
`src/lib/admin-activity.js`:

- `actorLabel(event)` — a real `ma_profiles.display_name` for a human actor,
  or a best-effort system-source label (`Agenda-sync`, `Briefing-sync`,
  `E-mailcontrole`, falling back to `Systeem`) for `actor_type = 'system'`.
  The private irma-sync job's exact action vocabulary lives outside this
  repo, so this degrades gracefully rather than guessing wrong.
- `activitySentence(event)` — a fixed Dutch sentence per known `action`,
  built **only** from the metadata keys documented in
  `METADATA_ALLOWLIST` for that action. An unrecognised action (or metadata
  that fails to build a sentence) falls back to a generic
  "Er is een systeemactie geregistreerd." rather than rendering raw JSON or
  throwing.
- `activityBucket(event, roster)` — Familie/Zorgteam/Systeem classification
  is done **client-side**, cross-referencing `actor_user_id` against the
  roster already fetched for the "Mensen en toegang" section
  (`buildRosterLookup`). `ma_activity_events` has no stored actor-role
  column by design (roles change over time; the event shouldn't). This is
  UI-convenience filtering only, not a security boundary — the owner already
  sees every row regardless of filter.

**Privacy contract (audit metadata).** Every event that a browser mutation
can trigger is written by the `ma_trg_*` SECURITY DEFINER trigger functions
in migration 007, which hard-code the metadata shape per action — the app
never freely writes to `ma_activity_events.metadata`. `metadata` may only
ever contain: counts, dates, statuses, audience/kind labels, and opaque
object ids. It must **never** contain: post/comment title or body text,
tags, filenames or storage paths, calendar event details, briefing text,
mail content, driver names, clock times, device labels, URLs, or emails.
`trusted_device_activated`/`trusted_device_revoked` metadata is hard-coded
`{}` — the pairing code, link token, device token hash, cookie, and device
label are **never** logged or audited, only the opaque device id as
`object_id`. `METADATA_ALLOWLIST` in `admin-activity.js` documents this
contract on the read side too, and a unit test
(`admin-activity.test.mjs`) asserts every known action's metadata keys are
covered by it and that the trusted-device actions' allowlists are empty.

**Meaningful-action triggers** (migration 007, all `after` triggers, all
gated on `auth.uid() is not null` so the service-role sync job's own
reporting is never duplicated):

| Table | Trigger | Actions recorded |
|---|---|---|
| `ma_posts` | `ma_posts_activity_trg` | `logboek_created`, `logboek_updated`, `logboek_audience_changed`, `logboek_deleted` |
| `ma_comments` | `ma_comments_activity_trg` | `comment_added` |
| `ma_attachments` | `ma_attachments_activity_trg` | `attachment_added`, `attachment_removed` |
| `ma_briefings` | `ma_briefings_activity_trg` | `briefing_marked_sent`, `briefing_reopened` |
| `ma_ride_notices` | `ma_ride_notices_activity_trg` | `ride_notice_dismissed` |
| `ma_care_team_members` | `ma_care_team_members_activity_trg` | `caregiver_access_granted`, `caregiver_access_revoked` (attributed via `created_by`/`revoked_by`, not the session — provisioning is a manual admin action with no browser insert policy, so there usually is no authenticated session to read) |

`trusted_device_activated`/`trusted_device_revoked` come from the Netlify
Functions directly (`recordActivity()` in `_ma-activity.js`), not a DB
trigger, since those tables are default-deny to every browser role.

**The private irma-sync job's own activity rows.** Four further actions —
`calendar_changed`, `briefings_generated`, `ride_notices_changed`, and
`pipeline_attention` — are written by the private irma-sync job itself
(service role) when a run actually changes something or needs attention.
`admin-activity.js` renders each with a specific Dutch sentence built only
from its allowlisted counts/status (e.g. "Heeft de agenda bijgewerkt: 1
afspraak toegevoegd, 2 afspraken gewijzigd en 1 afspraak geannuleerd.")
instead of the generic "Er is een systeemactie geregistreerd." fallback.
`pipeline_attention`'s `error_stage` is never rendered raw — it is mapped to
a small set of calm, non-technical Dutch sentences.

**Quiet runs stay quiet, by design.** A scheduled run that completes
successfully with nothing to report does **not** write a row here — the
activity feed is not a heartbeat, `ma_integration_runs` is (see
"Systeemstatus" above). This means Beheer can correctly show a healthy,
recent automatic run in Systeemstatus with no corresponding new item in
Recente activiteit, and that is the expected, quiet-success case — not a
gap. The sync schedule itself remains every three hours; nothing here
implies every run produces an activity item.

**Follow-up note:** `membership_role_changed` is a known action label
(`admin-activity.js` already renders it, and it was used for the one-time,
manually-recorded promotion described below) but has **no** automatic
`ma_family_members` trigger in this PR — role changes are not a
self-service feature here (see "Follow-up risks"), so no trigger was built
for a path the app doesn't otherwise expose.

### Mensen en toegang

`ma_admin_roster(family_id)` — a `SECURITY DEFINER`, `STABLE` RPC, `EXECUTE`
granted only to `authenticated` — unions `ma_family_members` (owner/member)
with `ma_care_team_members` (active **and** revoked caregivers stay visible
to the owner) and left-joins `ma_profiles` for the display name, plus
`ma_user_presence.last_seen_at` and a correlated max over
`ma_activity_events.occurred_at` for "last meaningful action." It returns
**nothing at all** for a non-owner caller — checked with
`ma_is_family_owner()` before any other row is touched, so there is no
partial-roster leak.

### Apparaten

A compact summary card (device count, most-recent activity) linking through
to the existing **Apparaten** management view — this PR deliberately does
**not** duplicate the setup/revoke UI here.

### Prullenbak

A summary card (trashed-entry count) linking through to `views/prullenbak.js`
— the owner-only trash for soft-deleted Logboek entries: a compact preview,
original author, deletion date, and who deleted it, with **Herstellen** and
**Definitief verwijderen** (a second explicit confirmation) per row, and its
own simple text search. RLS (migration 008) returns nothing here for anyone
but the owner regardless of what the route itself shows — see "Logboek —
edit, trash & search" above for the full permission model.

### Presence

`ma_touch_presence(family_id)` is a narrow SECURITY DEFINER RPC: it only
ever upserts the **caller's own** row (`auth.uid()`, never an accepted
parameter), only for an active family member or active caregiver of the
target family, and only if the existing row is more than ~10 minutes old
(the `ON CONFLICT ... DO UPDATE ... WHERE` clause is the database-layer
throttle). The client (`src/lib/presence-heartbeat.js`, wired into
`main.js`) adds its own lightweight throttle on top so a flurry of
`visibilitychange` events doesn't fire pointless network calls, and touches
once on sign-in, then every 15 minutes while the tab stays open. This is a
single "last active" timestamp per person, overwritten in place — **not** an
event stream, and no route/page/URL/title is ever recorded alongside it.

### Authorization matrix

Verified with live SQL RLS tests against synthetic data (same technique as
the Logboek matrix above — rollback-wrapped transactions with
`SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = …` simulating
each actor):

| Actor | Read `ma_integration_runs` | Read `ma_activity_events` | Read `ma_user_presence` | `ma_admin_roster()` | `ma_touch_presence()` | Device admin endpoints |
|---|---|---|---|---|---|---|
| Family owner | yes | yes | yes | full roster | own row only | yes |
| Family member | no | no | no | empty | own row only | no (403) |
| Active caregiver | no | no | no | empty | own row only | no (403) |
| Revoked caregiver | no | no | no | empty | no-op (not active) | no (403) |
| Unrelated signed-in user | no | no | no | empty | no-op (not a member) | no (403) |
| Anonymous | no | no | no | n/a (`authenticated`-only grant) | n/a (`authenticated`-only grant) | no (401) |

### Live-data note

As part of shipping this PR, the family's second administrator was promoted
from `member` to `owner` in production (`ma_family_members.role`), with one
corresponding `membership_role_changed` activity event recorded manually for
the audit trail. No name, email, user id, or family id from that operation
appears anywhere in this repository, its history, or its fixtures — this
README and the PR description refer to it only as "the second
administrator."

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
Beheer, or Apparaten (device management), and Logboek shows only
`care_team`-audience entries. **Beheer and Apparaten are further
restricted to `owner` only** — a plain family `member` doesn't see them
either, only a caregiver-vs-member distinction elsewhere. This is enforced
twice, independently: the route itself doesn't exist for a disallowed
`accessType` (`main.js`'s `ROUTE_ACCESS` map and `routeAllowedFor()` guard,
even against a hand-typed hash), and the underlying data is RLS-gated
regardless of what the UI shows.

---

## Follow-up risks

Deliberately deferred out of scope across the Logboek and Beheer PRs, tracked
here rather than shipped as a half-finished feature:

- ~~The irma-sync job doesn't consume `ma_sync_requests` yet.~~ **Resolved:**
  `ma-sync-trigger.js` now dispatches the private irma-sync workflow directly
  via the GitHub API, and that job (a separate, private codebase) claims the
  request and stamps `trigger_source`/`triggered_by_request_id` on the run it
  produces — see "Agenda-synchronisatie — manual refresh" above.
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
- **Self-service role editing.** Promoting/demoting a family member between
  `member` and `owner` is a manual SQL step (see "Live-data note" under
  "Beheer" above), not a Beheer UI action — the brief explicitly scoped role
  editing out of this PR. `admin-activity.js` already knows how to render a
  `membership_role_changed` event (used for that one manual promotion), but
  no `ma_family_members` trigger auto-generates one, since the app has no
  path that produces this action itself.
- **Beheer doesn't duplicate device setup/revoke UI.** The Apparaten card is
  a summary + link to the existing management view (see "Trusted devices"
  above) — intentionally, per the brief, rather than a second implementation
  of the same flow.
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
| Run tests             | `npm test` (state engine, Beheer health rules, activity mapping, presence heartbeat, GA-absence, device crypto/derive, Netlify function handlers incl. `ma-sync-trigger`) |
| State engine × TZ     | `npm run test:today-state` (UTC/NY/Amsterdam/Jakarta) |
| Logboek / Beheer RLS tests | No repo script (SQL run directly against the live project via Supabase MCP, using synthetic families/users wrapped in a single rollback-wrapped transaction — see the PR description for the full authorization-matrix results, including the Logboek trash RPCs added in this PR) |
| Manual acceptance     | See `apps/ma/TRUSTED_DEVICES.md`                     |
| Check errors          | Browser console; errors logged with `[ma/...]` prefix |
