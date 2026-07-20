-- 010_ma_sync_manual_dispatch.sql — idempotent; reflects intended live schema
--
-- Closes the loop opened by 009_ma_calendar_manual_sync.sql: that migration
-- added ma_sync_requests as a *signal* the private irma-sync job could act on
-- once it was updated to consume it, but this repo had no code path that
-- could invoke the job directly. This migration adds what the two follow-up
-- changes need:
--
--   A. Dispatch-status fields on ma_sync_requests — ma-sync-trigger.js now
--      calls GitHub's workflow-dispatch API directly; these fields record
--      whether that call succeeded, so a failed dispatch can be retried
--      immediately instead of blocking behind the existing 20-minute
--      "still fresh, don't duplicate" window (see netlify/functions/ma-sync-
--      trigger.js and apps/ma/README.md "Agenda-synchronisatie — manual
--      refresh").
--   B. ma_claim_sync_request(uuid, uuid) — a SECURITY DEFINER RPC, callable
--      only by the service role, that the private irma-sync job calls to
--      atomically claim a request (UPDATE ... WHERE claimed_at IS NULL) so
--      a duplicate dispatch, a stale claim, or a request for another family
--      can never link two runs to the same request row. It only ever sets
--      claimed_at — never run_id — because the ma_integration_runs row it
--      would reference doesn't exist yet at claim time (ma_sync_requests
--      .run_id has a foreign key to ma_integration_runs.id); the job links
--      run_id with a plain follow-up update once that row exists.
--
-- No browser write policy is added or widened — every write here still goes
-- through the ma-sync-trigger Netlify Function (service role) or the private
-- irma-sync job (service role), exactly as migration 009 established.

-- ── A. Dispatch-status fields ────────────────────────────────────────────────

alter table ma_sync_requests add column if not exists dispatch_status text not null default 'pending';

do $$ begin
  alter table ma_sync_requests add constraint ma_sync_requests_dispatch_status_check
    check (dispatch_status in ('pending', 'dispatched', 'failed'));
exception when duplicate_object then null;
end $$;

alter table ma_sync_requests add column if not exists dispatch_attempted_at timestamptz;
alter table ma_sync_requests add column if not exists dispatched_at timestamptz;
alter table ma_sync_requests add column if not exists dispatch_error_code text;

do $$ begin
  alter table ma_sync_requests add constraint ma_sync_requests_dispatch_error_code_check
    check (
      dispatch_error_code is null
      or dispatch_error_code in ('config_error', 'network_error', 'github_client_error', 'github_server_error')
    );
exception when duplicate_object then null;
end $$;

-- Safe, non-sensitive: GitHub Actions run ids are not secret. Populated only
-- when GitHub's 200-with-body dispatch response includes one (brief §B1) —
-- never required, never exposed as a private Actions URL.
alter table ma_sync_requests add column if not exists github_run_id text;

-- Replaces migration 009's idx_ma_sync_requests_pending: a failed dispatch
-- must not keep matching the "still fresh, don't duplicate" query.
drop index if exists idx_ma_sync_requests_pending;
create index if not exists idx_ma_sync_requests_pending_dispatchable
  on ma_sync_requests (family_id, requested_at desc)
  where claimed_at is null and dispatch_status <> 'failed';

-- ── B. Atomic claim RPC — service-role only ──────────────────────────────────

create or replace function public.ma_claim_sync_request(p_request_id uuid, p_family_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row_count int;
begin
  update ma_sync_requests
  set claimed_at = now()
  where id = p_request_id
    and family_id = p_family_id
    and claimed_at is null;
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

-- service-role only: no browser role (anon/authenticated) may ever call this
-- — the private irma-sync job is the sole caller, via the service-role key.
revoke all on function public.ma_claim_sync_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ma_claim_sync_request(uuid, uuid) to service_role;
