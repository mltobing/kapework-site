-- 012_ma_calendar_actions_and_appointment_notices.sql — idempotent; reflects
-- intended live schema. NOT applied by Claude Code — review and apply by hand.
--
-- Two related additions:
--
--   A. ma_appointment_notices — a second, independent mail-reconciliation
--      table (alongside ma_ride_notices) for direct automated appointment
--      confirmations from a care provider. Written only by the private
--      irma-sync job (service role; see appointments.py there). Mirrors
--      ma_ride_notices' shape/RLS/guard-trigger pattern exactly (migration
--      004) — family members may read and dismiss; every extracted/match
--      field is immutable to them.
--
--   B. ma_calendar_write_requests / ma_calendar_write_items — the
--      owner-confirmed "Toevoegen aan agenda" flow. An owner reviews a
--      missing/unparsed ride or appointment notice and explicitly confirms;
--      the owner-authenticated Netlify Function (ma-calendar-write-
--      request.js) creates one request row (+ 1-2 item rows) and dispatches
--      the private irma-sync workflow, which claims the request atomically
--      (ma_claim_calendar_write_request below), writes to the pinned iCloud
--      calendar idempotently, then always runs its normal mirror pass before
--      finalizing the request's status. No browser INSERT/UPDATE/DELETE on
--      either table at all — owners may only SELECT their own family's rows;
--      every write is service-role (the Netlify Function or the sync job).
--
-- Non-negotiable safety properties this schema enforces (see the brief):
--   - ma_calendar_events remains untouched by this migration and by every
--     write path built on top of it — it stays a read-only mirror of iCloud;
--     irma-sync writes iCloud first, then mirrors it through the existing
--     unchanged sync pipeline.
--   - No event payload (title/times/location/notes) is ever exposed to a
--     non-owner: every read policy on the write-request/item tables is
--     owner-only, full stop.
--   - A retry reuses the same request row rather than creating a second one
--     — enforced here by the partial unique indexes on ride_notice_id /
--     appointment_notice_id, not left to application-layer discipline alone.
--   - No care-team access is granted to either new table in this migration.

-- ── A. ma_appointment_notices ──────────────────────────────────────────────

create table if not exists ma_appointment_notices (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references ma_families(id) on delete cascade,
  source_message_id  text not null,
  thread_id          text,
  provider_key       text not null,
  provider_label     text not null,
  received_at        timestamptz not null,
  kind               text not null check (kind in ('confirmation', 'unknown')),
  appointment_date   date,
  start_time         time,
  end_time           time,
  practitioner       text,
  location           text,
  excerpt            text not null,
  confidence         text not null default 'high' check (confidence in ('high', 'low')),
  match_status       text not null check (match_status in ('matched', 'missing', 'conflict', 'unparsed')),
  matched_event_uid  text,
  state              text not null default 'open' check (state in ('open', 'dismissed', 'resolved')),
  dismissed_by       uuid references ma_profiles(user_id),
  dismissed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint ma_appointment_notices_provider_key_check
    check (char_length(trim(provider_key)) between 1 and 80 and provider_key ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint ma_appointment_notices_provider_label_len
    check (char_length(trim(provider_label)) between 1 and 120),
  constraint ma_appointment_notices_practitioner_len
    check (practitioner is null or char_length(practitioner) <= 160),
  constraint ma_appointment_notices_location_len
    check (location is null or char_length(location) <= 300),
  constraint ma_appointment_notices_excerpt_len
    check (char_length(trim(excerpt)) between 1 and 1200),
  constraint ma_appointment_notices_times_order
    check (start_time is null or end_time is null or end_time > start_time),

  unique (family_id, source_message_id, appointment_date)
);

create index if not exists ma_appointment_notices_open_idx
  on ma_appointment_notices (family_id, state, appointment_date);

alter table ma_appointment_notices enable row level security;

drop policy if exists appointment_notices_select on ma_appointment_notices;
create policy appointment_notices_select on ma_appointment_notices for select
  using (ma_is_family_member(family_id));

drop policy if exists appointment_notices_update on ma_appointment_notices;
create policy appointment_notices_update on ma_appointment_notices for update
  using (ma_is_family_member(family_id))
  with check (ma_is_family_member(family_id));

revoke insert, delete on ma_appointment_notices from anon, authenticated;

-- Same reasoning as ma_ride_notices_guard_columns (migration 004): everything
-- the reconciliation job wrote is immutable to members — the card can always
-- be trusted against the original e-mail. Members may change only
-- state/dismissed_by/dismissed_at ("Negeer"). Service-role writes bypass RLS
-- and this trigger's auth.uid() guard, so upserts and auto-resolve/auto-match
-- are unaffected.
create or replace function ma_appointment_notices_guard_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.family_id          is distinct from old.family_id
  or new.source_message_id  is distinct from old.source_message_id
  or new.thread_id          is distinct from old.thread_id
  or new.provider_key       is distinct from old.provider_key
  or new.provider_label     is distinct from old.provider_label
  or new.received_at        is distinct from old.received_at
  or new.kind               is distinct from old.kind
  or new.appointment_date   is distinct from old.appointment_date
  or new.start_time         is distinct from old.start_time
  or new.end_time           is distinct from old.end_time
  or new.practitioner       is distinct from old.practitioner
  or new.location            is distinct from old.location
  or new.excerpt            is distinct from old.excerpt
  or new.confidence         is distinct from old.confidence
  or new.match_status       is distinct from old.match_status
  or new.matched_event_uid  is distinct from old.matched_event_uid
  or new.created_at         is distinct from old.created_at
  or new.updated_at         is distinct from old.updated_at then
    raise exception 'ma_appointment_notices: only state/dismissed_by/dismissed_at are member-writable';
  end if;
  return new;
end; $$;

drop trigger if exists ma_appointment_notices_guard_columns_trg on ma_appointment_notices;
create trigger ma_appointment_notices_guard_columns_trg
  before update on ma_appointment_notices
  for each row execute function ma_appointment_notices_guard_columns();

-- Same pattern as ma_trg_ride_notice_activity (migration 007): a member
-- dismissing a notice ("Negeer") is the only member-initiated state change
-- this table allows, so it is the only transition that needs recording here.
-- Auto-match/auto-resolve is a service-role write with no auth.uid(), so it
-- never fires this trigger — consistent with ride notices.
create or replace function public.ma_trg_appointment_notice_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if OLD.state is distinct from NEW.state and NEW.state = 'dismissed' then
    perform ma_record_activity_event(
      NEW.family_id, 'user', auth.uid(), 'app', 'appointment_notice_dismissed',
      'appointment_notice', NEW.id, 'info',
      jsonb_build_object('kind', NEW.kind, 'appointment_date', NEW.appointment_date),
      null
    );
  end if;
  return NEW;
end;
$$;

revoke execute on function public.ma_trg_appointment_notice_activity() from public, anon, authenticated;

drop trigger if exists ma_appointment_notices_activity_trg on ma_appointment_notices;
create trigger ma_appointment_notices_activity_trg
  after update on ma_appointment_notices
  for each row execute function ma_trg_appointment_notice_activity();

-- ── B. ma_calendar_write_requests ──────────────────────────────────────────

create table if not exists ma_calendar_write_requests (
  id                       uuid primary key default gen_random_uuid(),
  family_id                uuid not null references ma_families(id) on delete cascade,
  requested_by             uuid not null references ma_profiles(user_id),
  source_kind              text not null check (source_kind in ('ride_notice', 'appointment_notice')),
  ride_notice_id           uuid references ma_ride_notices(id) on delete set null,
  appointment_notice_id    uuid references ma_appointment_notices(id) on delete set null,
  operation                text not null default 'create' check (operation = 'create'),
  status                   text not null default 'queued'
                           check (status in ('queued', 'processing', 'success', 'partial', 'failed', 'cancelled')),
  dispatch_status          text not null default 'pending' check (dispatch_status in ('pending', 'dispatched', 'failed')),
  claimed_at               timestamptz,
  integration_run_id       uuid references ma_integration_runs(id) on delete set null,
  github_run_id            text,
  write_status             text not null default 'pending'
                           check (write_status in ('pending', 'processing', 'success', 'partial', 'failed')),
  mirror_status            text not null default 'pending' check (mirror_status in ('pending', 'success', 'failed')),
  error_code               text,
  requested_at             timestamptz not null default now(),
  dispatch_attempted_at    timestamptz,
  dispatched_at            timestamptz,
  finished_at              timestamptz,
  created_at               timestamptz not null default now(),

  constraint ma_calendar_write_requests_error_code_len check (error_code is null or char_length(error_code) <= 80),
  constraint ma_calendar_write_requests_github_run_id_len check (github_run_id is null or char_length(github_run_id) <= 80),
  -- Exactly one notice FK is set, and it must match the declared source_kind
  -- — the request can never be ambiguous about which notice it came from.
  constraint ma_calendar_write_requests_source_match check (
    (source_kind = 'ride_notice' and ride_notice_id is not null and appointment_notice_id is null)
    or (source_kind = 'appointment_notice' and appointment_notice_id is not null and ride_notice_id is null)
  )
);

-- One request per source notice, ever — a retry must reuse the same request
-- row rather than create a second one. Partial (not a plain UNIQUE) because
-- exactly one of the two columns is populated per row (see the check above).
create unique index if not exists idx_ma_calendar_write_requests_ride_notice
  on ma_calendar_write_requests (ride_notice_id) where ride_notice_id is not null;
create unique index if not exists idx_ma_calendar_write_requests_appointment_notice
  on ma_calendar_write_requests (appointment_notice_id) where appointment_notice_id is not null;

create index if not exists idx_ma_calendar_write_requests_family_requested
  on ma_calendar_write_requests (family_id, requested_at desc);

alter table ma_calendar_write_requests enable row level security;
-- Owner-only SELECT; no browser INSERT/UPDATE/DELETE at all — every write
-- goes through the ma-calendar-write-request Netlify Function's service-role
-- key (create/dispatch) or the private irma-sync job's service-role key
-- (claim/finalize), mirroring ma_sync_requests (migration 009/010).
revoke insert, update, delete on ma_calendar_write_requests from anon, authenticated;

create policy "ma_calendar_write_requests: owner can read"
  on ma_calendar_write_requests for select
  using (ma_is_family_owner(family_id));

-- ── C. ma_calendar_write_items ─────────────────────────────────────────────

create table if not exists ma_calendar_write_items (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references ma_calendar_write_requests(id) on delete cascade,
  family_id       uuid not null references ma_families(id) on delete cascade,
  sequence_no     smallint not null check (sequence_no between 1 and 2),
  event_uid       text not null unique,
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  location        text,
  notes           text,
  status          text not null default 'pending' check (status in ('pending', 'written', 'failed')),
  error_code      text,
  written_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint ma_calendar_write_items_title_len check (char_length(trim(title)) between 1 and 120),
  constraint ma_calendar_write_items_ends_after_starts check (ends_at > starts_at),
  constraint ma_calendar_write_items_location_len check (location is null or char_length(location) <= 300),
  constraint ma_calendar_write_items_notes_len check (notes is null or char_length(notes) <= 1200),
  constraint ma_calendar_write_items_event_uid_len check (char_length(trim(event_uid)) between 1 and 200),
  constraint ma_calendar_write_items_error_code_len check (error_code is null or char_length(error_code) <= 80),

  unique (request_id, sequence_no)
);

create index if not exists idx_ma_calendar_write_items_request on ma_calendar_write_items (request_id);

alter table ma_calendar_write_items enable row level security;
revoke insert, update, delete on ma_calendar_write_items from anon, authenticated;

create policy "ma_calendar_write_items: owner can read"
  on ma_calendar_write_items for select
  using (ma_is_family_owner(family_id));

-- ── D. ma_claim_calendar_write_request() — atomic claim, service-role only ──
-- Same pattern as ma_claim_sync_request (migration 010): an UPDATE guarded by
-- WHERE so a duplicate dispatch, a stale claim, or a request for another
-- family can never be claimed twice or cross-family. Only ever sets
-- claimed_at/write_status — never integration_run_id — because sync.py links
-- that separately once the ma_integration_runs row exists (mirroring
-- _link_request_to_run's two-phase approach for manual sync requests).
--
-- No separate "finalize" RPC: every later write (item status, write_status,
-- mirror_status, finished_at, status) is a plain service-role UPDATE with no
-- compare-and-swap requirement, since only the one run that successfully
-- claimed a request ever processes it.

create or replace function public.ma_claim_calendar_write_request(p_request_id uuid, p_family_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row_count int;
begin
  update ma_calendar_write_requests
  set status = 'processing',
      write_status = 'processing',
      claimed_at = now()
  where id = p_request_id
    and family_id = p_family_id
    and status = 'queued';
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

revoke all on function public.ma_claim_calendar_write_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ma_claim_calendar_write_request(uuid, uuid) to service_role;

-- ── E. ma_integration_runs: correlate a run back to a calendar-write request ─

alter table ma_integration_runs
  add column if not exists triggered_by_calendar_write_request_id uuid references ma_calendar_write_requests(id);

create index if not exists idx_ma_integration_runs_triggered_by_calendar_write
  on ma_integration_runs (triggered_by_calendar_write_request_id)
  where triggered_by_calendar_write_request_id is not null;

-- trigger_source's existing check ('schedule', 'manual' — migration 009)
-- already covers a calendar-write-dispatched run: it is 'manual', exactly
-- like an owner-triggered sync refresh. No third value is introduced.
