-- 004_ma_ride_notices.sql — idempotent; reflects live schema
--
-- Ride-reconciliation notices. Rows are written ONLY by the private irma-sync
-- job (service role): it reads forwarded ride e-mails, compares each one against
-- the mirrored ma_calendar_events, and records every discrepancy here for a human
-- to resolve. This feature never writes to the calendar and never creates events —
-- the machine finds the gap, the human decides.
--
-- Mirrors the ma_briefings pattern exactly:
--   * the ma_is_family_member() helper (ma_family_members carries its own RLS, so
--     an inline EXISTS would not see the rows the SECURITY DEFINER helper can);
--   * no INSERT/DELETE policy — rows are created and superseded by the service role;
--   * a BEFORE UPDATE guard trigger so members may flip only the dismissal fields.

create table if not exists ma_ride_notices (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references ma_families(id) on delete cascade,
  source_message_id  text not null,
  thread_id          text,
  received_at        timestamptz not null,
  kind               text not null check (kind in ('ride','cancellation','change','unknown')),
  ride_date          date,
  driver             text,
  pickup_time        time,
  return_time        time,
  destination        text,
  return_place       text,
  excerpt            text not null,
  confidence         text not null default 'high' check (confidence in ('high','low')),
  match_status       text not null check (match_status in ('matched','missing','conflict','unparsed')),
  matched_event_uid  text,
  state              text not null default 'open' check (state in ('open','dismissed','resolved')),
  dismissed_by       uuid references ma_profiles(user_id),
  dismissed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (family_id, source_message_id, ride_date)
);

create index if not exists ma_ride_notices_open_idx
  on ma_ride_notices (family_id, state, ride_date);

alter table ma_ride_notices enable row level security;

drop policy if exists ride_notices_select on ma_ride_notices;
create policy ride_notices_select on ma_ride_notices for select
  using (ma_is_family_member(family_id));

drop policy if exists ride_notices_update on ma_ride_notices;
create policy ride_notices_update on ma_ride_notices for update
  using (ma_is_family_member(family_id))
  with check (ma_is_family_member(family_id));

-- Everything the reconciliation job wrote — the extracted ride, the match verdict,
-- and the verbatim excerpt — is immutable to members. The card can therefore always
-- be trusted against the original e-mail. Members may change only state /
-- dismissed_by / dismissed_at (the "Negeer" action). Service-role writes bypass RLS
-- and this trigger's auth.uid() guard, so upserts and auto-resolve are unaffected.
create or replace function ma_ride_notices_guard_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.family_id         is distinct from old.family_id
  or new.source_message_id is distinct from old.source_message_id
  or new.thread_id         is distinct from old.thread_id
  or new.received_at       is distinct from old.received_at
  or new.kind              is distinct from old.kind
  or new.ride_date         is distinct from old.ride_date
  or new.driver            is distinct from old.driver
  or new.pickup_time       is distinct from old.pickup_time
  or new.return_time       is distinct from old.return_time
  or new.destination       is distinct from old.destination
  or new.return_place      is distinct from old.return_place
  or new.excerpt           is distinct from old.excerpt
  or new.confidence        is distinct from old.confidence
  or new.match_status      is distinct from old.match_status
  or new.matched_event_uid is distinct from old.matched_event_uid
  or new.created_at        is distinct from old.created_at
  or new.updated_at        is distinct from old.updated_at then
    raise exception 'ma_ride_notices: only state/dismissed_by/dismissed_at are member-writable';
  end if;
  return new;
end; $$;

drop trigger if exists ma_ride_notices_guard_columns_trg on ma_ride_notices;
create trigger ma_ride_notices_guard_columns_trg
  before update on ma_ride_notices
  for each row execute function ma_ride_notices_guard_columns();
