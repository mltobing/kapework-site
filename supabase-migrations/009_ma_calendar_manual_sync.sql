-- 009_ma_calendar_manual_sync.sql — idempotent; reflects intended live schema
--
-- Owner-only "Agenda nu bijwerken" — lets an owner ask for an immediate run of
-- the calendar/briefing/AutoMaatje pipeline instead of waiting for its normal
-- ~3-hour cycle.
--
-- IMPORTANT — read before wiring this into anything else: the pipeline itself
-- (the private irma-sync job) runs entirely outside this repository — see
-- apps/ma/README.md "Calendar sync" and "Systeemstatus". This repo has no
-- code path that can invoke it directly (confirmed: no Supabase Edge Function
-- is deployed for it, and there is no webhook/trigger URL configured anywhere
-- in this project). Re-implementing calendar/briefing fetching here to make
-- the button "really" instant would be exactly the "separate competing
-- implementation" the brief says not to build, and would risk diverging from
-- that job's own idempotency (upsert-on-external_event_uid) guarantees.
--
-- So this migration only adds a *signal* the job can act on:
--   ma_sync_requests        — one row per manual request; owner-only SELECT,
--                              no browser write policy (written by the
--                              ma-sync-trigger Netlify Function via the
--                              service role, mirroring ma_activity_events).
--   ma_integration_runs.trigger_source / triggered_by_request_id
--                              — lets a run correlate back to the request that
--                              produced it, once the job is updated to do so.
--
-- Follow-up required OUTSIDE this repo (tracked in apps/ma/README.md "Follow-
-- up risks"): the irma-sync job needs to poll ma_sync_requests for an
-- unclaimed row at the start of each cycle, run immediately if one exists
-- instead of waiting out its interval, then set claimed_at/run_id here and
-- stamp the ma_integration_runs row it produces with trigger_source='manual'
-- and triggered_by_request_id. Until that ships, a manual request is recorded
-- and fully audited (who, when) but is only ever picked up on the job's own
-- schedule — the Beheer UI copy is deliberately honest about this ("kan een
-- paar minuten duren" rather than claiming instant completion).

-- ── A. ma_sync_requests ────────────────────────────────────────────────────────

create table if not exists ma_sync_requests (
  id            uuid        primary key default gen_random_uuid(),
  family_id     uuid        not null references ma_families(id) on delete cascade,
  requested_by  uuid        not null references ma_profiles(user_id),
  requested_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  run_id        uuid,       -- set by the job once it correlates a run to this request
  created_at    timestamptz not null default now()
);

create index if not exists idx_ma_sync_requests_family_requested
  on ma_sync_requests (family_id, requested_at desc);
create index if not exists idx_ma_sync_requests_pending
  on ma_sync_requests (family_id, requested_at desc) where claimed_at is null;

alter table ma_sync_requests enable row level security;
-- Owner-only SELECT; no browser INSERT/UPDATE/DELETE policy at all — every
-- write goes through the ma-sync-trigger Netlify Function's service-role key,
-- mirroring ma_integration_runs / ma_activity_events (migration 007).
revoke insert, update, delete on ma_sync_requests from anon, authenticated;

create policy "ma_sync_requests: owner can read"
  on ma_sync_requests for select
  using (ma_is_family_owner(family_id));

-- ── B. ma_integration_runs: correlate a run back to a manual request ─────────

alter table ma_integration_runs add column if not exists trigger_source text not null default 'schedule';

do $$ begin
  alter table ma_integration_runs add constraint ma_integration_runs_trigger_source_check
    check (trigger_source in ('schedule', 'manual'));
exception when duplicate_object then null;
end $$;

alter table ma_integration_runs add column if not exists triggered_by_request_id uuid references ma_sync_requests(id);

-- Now that ma_sync_requests exists, backfill the forward reference from A.
do $$ begin
  alter table ma_sync_requests add constraint ma_sync_requests_run_id_fkey
    foreign key (run_id) references ma_integration_runs(id);
exception when duplicate_object then null;
end $$;

create index if not exists idx_ma_integration_runs_triggered_by_request
  on ma_integration_runs (triggered_by_request_id) where triggered_by_request_id is not null;
