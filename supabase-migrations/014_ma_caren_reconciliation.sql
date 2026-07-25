-- 014_ma_caren_reconciliation.sql — idempotent, purely additive.
--
-- Two independent things, deliberately in one migration because the private
-- irma-sync job needs both before its next deploy:
--
--   1. ma_ride_notices.extraction_version — lets the AutoMaatje repair pass
--      identify rows written by an older extractor and reprocess them exactly
--      once (see irma-sync's notices.py, RIDE_EXTRACTION_VERSION).
--
--   2. The Caren reconciliation tables — evidence, expected items, review
--      audit — plus the owner-only review RPC.
--
-- ---------------------------------------------------------------------------
-- What Caren reconciliation is, and what it is NOT
-- ---------------------------------------------------------------------------
-- Caren (Nedap) e-mails the family when an appointment is added or changed,
-- and again shortly before it starts. The private job reads those e-mails
-- read-only from the mailbox it already uses, and matches them against what
-- Ma's briefing says should be in Caren.
--
-- This is POSITIVE EVIDENCE ONLY. An e-mail proves an appointment existed in
-- Caren when the message was generated. The absence of an e-mail proves
-- nothing at all — Caren may simply not have notified, or the message may have
-- been filtered. No reliable deletion-notification template has been observed,
-- so deletion is never inferred. UI copy says "Nog niet gezien in Caren",
-- never "ontbreekt in Caren".
--
-- Nothing here ever writes to Caren, logs into Caren, or sends an e-mail.
--
-- ---------------------------------------------------------------------------
-- Privacy
-- ---------------------------------------------------------------------------
-- Caren notification bodies contain a calendar URL of the shape
--   https://caren.nl/people/<private-id>/calendar?date=YYYY-MM-DD
-- Only the `date` query parameter is ever parsed. The URL and the person id
-- are discarded at parse time and have no column here — deliberately, so they
-- cannot be stored by accident.
--
-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- Owner-only for this MVP: this is administrative reconciliation that John and
-- Martin need, and ordinary family members and care-team users do not. UI
-- hiding is not authorization — every table below is owner-SELECT-only with no
-- browser write path at all, and the one mutation entry point is a
-- SECURITY DEFINER RPC that re-checks ownership itself.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ma_ride_notices.extraction_version
-- ═══════════════════════════════════════════════════════════════════════════

-- Existing rows read as 'legacy', which is always unequal to the current
-- extractor version and therefore always eligible for the repair pass.
alter table ma_ride_notices
  add column if not exists extraction_version text not null default 'legacy';

alter table ma_ride_notices
  drop constraint if exists ma_ride_notices_extraction_version_len;

alter table ma_ride_notices
  add constraint ma_ride_notices_extraction_version_len
  check (char_length(trim(extraction_version)) between 1 and 40);

-- Replaces the guard from migration 004, adding extraction_version to the
-- immutable set. Everything the reconciliation job wrote stays immutable to
-- browser users; members may still change only state / dismissed_by /
-- dismissed_at (the "Negeer" action). Service-role writes bypass RLS and this
-- trigger's auth.uid() guard, so the job's upserts and repair updates are
-- unaffected.
create or replace function ma_ride_notices_guard_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.family_id          is distinct from old.family_id
  or new.source_message_id  is distinct from old.source_message_id
  or new.thread_id          is distinct from old.thread_id
  or new.received_at        is distinct from old.received_at
  or new.kind               is distinct from old.kind
  or new.ride_date          is distinct from old.ride_date
  or new.driver             is distinct from old.driver
  or new.pickup_time        is distinct from old.pickup_time
  or new.return_time        is distinct from old.return_time
  or new.destination        is distinct from old.destination
  or new.return_place       is distinct from old.return_place
  or new.excerpt            is distinct from old.excerpt
  or new.confidence         is distinct from old.confidence
  or new.match_status       is distinct from old.match_status
  or new.matched_event_uid  is distinct from old.matched_event_uid
  or new.extraction_version is distinct from old.extraction_version
  or new.created_at         is distinct from old.created_at
  or new.updated_at         is distinct from old.updated_at then
    raise exception 'ma_ride_notices: only state/dismissed_by/dismissed_at are member-writable';
  end if;
  return new;
end; $$;

drop trigger if exists ma_ride_notices_guard_columns_trg on ma_ride_notices;
create trigger ma_ride_notices_guard_columns_trg
  before update on ma_ride_notices
  for each row execute function ma_ride_notices_guard_columns();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ma_integration_runs.caren_status
-- ═══════════════════════════════════════════════════════════════════════════

-- Same shape and vocabulary as notices_status (009) and appointments_status
-- (013): one status column per optional mail stage, never a second set of
-- count columns. Existing rows default to 'skipped'.
alter table ma_integration_runs
  add column if not exists caren_status text not null default 'skipped';

alter table ma_integration_runs
  drop constraint if exists ma_integration_runs_caren_status_check;

alter table ma_integration_runs
  add constraint ma_integration_runs_caren_status_check
  check (caren_status = any (array['pending', 'success', 'failed', 'disabled', 'misconfigured', 'skipped']));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ma_caren_evidence — one parsed Caren notification e-mail
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ma_caren_evidence (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references ma_families(id) on delete cascade,
  -- Message identity, never thread identity: Caren's update messages all share
  -- the generic subject "Nieuwe of gewijzigde afspraak", so Gmail threads
  -- messages about entirely different appointments together. Using the thread
  -- as identity would silently merge unrelated evidence.
  source_message_id text not null,
  received_at       timestamptz not null,
  evidence_type     text not null,
  appointment_date  date,
  starts_at         timestamptz,
  ends_at           timestamptz,
  title             text,
  location          text,
  excerpt           text not null,
  confidence        text not null default 'high',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (family_id, source_message_id)
);

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_type_check;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_type_check
  check (evidence_type = any (array['updated', 'reminder', 'unparsed']));

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_confidence_check;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_confidence_check
  check (confidence = any (array['high', 'low']));

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_message_id_len;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_message_id_len
  check (char_length(trim(source_message_id)) between 1 and 500);

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_title_len;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_title_len
  check (title is null or char_length(title) <= 500);

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_location_len;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_location_len
  check (location is null or char_length(location) <= 500);

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_excerpt_len;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_excerpt_len
  check (char_length(trim(excerpt)) between 1 and 1200);

alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_window_order;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_window_order
  check (starts_at is null or ends_at is null or ends_at > starts_at);

-- A high-confidence row must actually carry the fields its type promises, so
-- the matcher can trust "high" without re-validating. A malformed message from
-- a real Caren sender is stored as 'unparsed' + low confidence instead of
-- being dropped — the owner should be able to see that something arrived and
-- could not be read.
alter table ma_caren_evidence
  drop constraint if exists ma_caren_evidence_high_confidence_fields;
alter table ma_caren_evidence
  add constraint ma_caren_evidence_high_confidence_fields
  check (
    confidence <> 'high'
    or (evidence_type = 'reminder'
        and appointment_date is not null
        and starts_at is not null
        and ends_at is not null
        and title is not null)
    or (evidence_type = 'updated'
        and appointment_date is not null
        and title is not null)
  );

create index if not exists ma_caren_evidence_date_idx
  on ma_caren_evidence (family_id, appointment_date, received_at desc);

create index if not exists ma_caren_evidence_type_idx
  on ma_caren_evidence (family_id, evidence_type, received_at desc);

alter table ma_caren_evidence enable row level security;

-- Owner SELECT only. No INSERT/UPDATE/DELETE policy exists at all, so no
-- browser session can write regardless of role; the private job writes with
-- the service role, which bypasses RLS.
drop policy if exists caren_evidence_select on ma_caren_evidence;
create policy caren_evidence_select on ma_caren_evidence for select
  using (ma_is_family_owner(family_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ma_caren_expected_items — what Ma says should be in Caren
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ma_caren_expected_items (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references ma_families(id) on delete cascade,
  briefing_id           uuid not null references ma_briefings(id) on delete cascade,
  briefing_date         date not null,
  -- SHA-256 over the cluster's sorted event UIDs. Stable across title, time
  -- and location edits, so an item that changes keeps its identity (and its
  -- review history) instead of appearing as a brand-new not-seen row.
  cluster_identity      text not null,
  sequence_no           smallint not null,
  -- SHA-256 over the cluster's canonical content. Changes whenever what the
  -- owner would have to enter in Caren changes.
  content_hash          text not null,
  content_changed_at    timestamptz not null default now(),
  expected_summary      text not null,
  event_uids            text[] not null default '{}',
  known_times           text[] not null default '{}',
  cluster_starts_at     timestamptz,
  cluster_ends_at       timestamptz,
  status                text not null default 'not_seen',
  matched_evidence_id   uuid references ma_caren_evidence(id) on delete set null,
  ambiguous_evidence_id uuid references ma_caren_evidence(id) on delete set null,
  matched_content_hash  text,
  matched_at            timestamptz,
  manual_confirmed_by   uuid references ma_profiles(user_id),
  manual_confirmed_at   timestamptz,
  retired_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (briefing_id, cluster_identity)
);

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_status_check;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_status_check
  check (status = any (array[
    'not_seen', 'seen', 'changed_after_seen', 'ambiguous', 'manually_confirmed', 'retired'
  ]));

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_sequence_range;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_sequence_range
  check (sequence_no between 1 and 20);

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_identity_len;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_identity_len
  check (char_length(trim(cluster_identity)) between 1 and 80);

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_content_hash_shape;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_content_hash_shape
  check (content_hash ~ '^[0-9a-f]{64}$');

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_matched_hash_shape;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_matched_hash_shape
  check (matched_content_hash is null or matched_content_hash ~ '^[0-9a-f]{64}$');

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_summary_len;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_summary_len
  check (char_length(trim(expected_summary)) between 1 and 1000);

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_event_uids_bounded;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_event_uids_bounded
  check (array_length(event_uids, 1) is null or array_length(event_uids, 1) <= 20);

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_known_times_bounded;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_known_times_bounded
  check (array_length(known_times, 1) is null or array_length(known_times, 1) <= 30);

-- Every known time is a bare Amsterdam wall-clock HH:MM. A CHECK constraint
-- cannot contain a subquery, so the per-element test goes through an immutable
-- helper function instead.
create or replace function public.ma_caren_times_are_hhmm(p_times text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog, public'
as $$
  select coalesce(bool_and(t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), true)
  from unnest(coalesce(p_times, '{}'::text[])) t;
$$;

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_known_times_shape;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_known_times_shape
  check (ma_caren_times_are_hhmm(known_times));

alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_window_order;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_window_order
  check (cluster_starts_at is null or cluster_ends_at is null or cluster_ends_at >= cluster_starts_at);

-- A status is never allowed to exist without the evidence that justifies it.
alter table ma_caren_expected_items
  drop constraint if exists ma_caren_expected_items_status_requires_evidence;
alter table ma_caren_expected_items
  add constraint ma_caren_expected_items_status_requires_evidence
  check (
    (status <> 'seen'               or (matched_evidence_id is not null and matched_content_hash is not null))
    and (status <> 'ambiguous'      or ambiguous_evidence_id is not null)
    and (status <> 'manually_confirmed'
         or (manual_confirmed_by is not null
             and manual_confirmed_at is not null
             and matched_content_hash is not null))
    and (status <> 'retired'        or retired_at is not null)
  );

create index if not exists ma_caren_expected_items_family_idx
  on ma_caren_expected_items (family_id, briefing_date, status);

create index if not exists ma_caren_expected_items_briefing_idx
  on ma_caren_expected_items (briefing_id, sequence_no);

create index if not exists ma_caren_expected_items_matched_idx
  on ma_caren_expected_items (matched_evidence_id);

create index if not exists ma_caren_expected_items_ambiguous_idx
  on ma_caren_expected_items (ambiguous_evidence_id);

alter table ma_caren_expected_items enable row level security;

-- Owner SELECT only; no browser write path. Owner mutations go exclusively
-- through ma_review_caren_item() below, which writes an audit row for every
-- decision — a direct UPDATE would bypass that audit trail.
drop policy if exists caren_expected_items_select on ma_caren_expected_items;
create policy caren_expected_items_select on ma_caren_expected_items for select
  using (ma_is_family_owner(family_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ma_caren_match_reviews — the owner decision audit trail
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists ma_caren_match_reviews (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references ma_families(id) on delete cascade,
  expected_item_id uuid not null references ma_caren_expected_items(id) on delete cascade,
  evidence_id      uuid references ma_caren_evidence(id) on delete set null,
  decision         text not null,
  decided_by       uuid not null references ma_profiles(user_id),
  decided_at       timestamptz not null default now()
);

alter table ma_caren_match_reviews
  drop constraint if exists ma_caren_match_reviews_decision_check;
alter table ma_caren_match_reviews
  add constraint ma_caren_match_reviews_decision_check
  check (decision = any (array['confirmed', 'rejected', 'manual_confirmed', 'reopened']));

create index if not exists ma_caren_match_reviews_item_idx
  on ma_caren_match_reviews (expected_item_id, decided_at desc);

-- The matcher's exclusion lookup: "has this (item, evidence) pair been
-- rejected?" A rejected pair is never re-proposed automatically.
create index if not exists ma_caren_match_reviews_pair_idx
  on ma_caren_match_reviews (expected_item_id, evidence_id);

alter table ma_caren_match_reviews enable row level security;

drop policy if exists caren_match_reviews_select on ma_caren_match_reviews;
create policy caren_match_reviews_select on ma_caren_match_reviews for select
  using (ma_is_family_owner(family_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. ma_review_caren_item() — the only owner mutation path
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER with a fixed search_path. Ownership is re-checked here, not
-- assumed from RLS, because this function bypasses RLS by design. The item row
-- is locked FOR UPDATE so two owners acting at once cannot interleave a status
-- change with its audit row.
--
-- Actions:
--   confirm_candidate  — accept the ambiguous candidate as the same appointment
--   reject_candidate   — it is NOT the same appointment; never re-proposed
--   manual_confirm     — "I have checked Caren myself; it is there"
--   reopen             — discard the current verdict and re-evaluate
create or replace function public.ma_review_caren_item(
  p_expected_item_id uuid,
  p_action           text,
  p_evidence_id      uuid default null
)
returns ma_caren_expected_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item     ma_caren_expected_items;
  v_evidence ma_caren_evidence;
  v_decision text;
  v_now      timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'caren_review_unauthorised';
  end if;

  select * into v_item
  from ma_caren_expected_items
  where id = p_expected_item_id
  for update;

  if not found then
    raise exception 'caren_invalid_item';
  end if;

  if not ma_is_family_owner(v_item.family_id) then
    raise exception 'caren_review_unauthorised';
  end if;

  -- A retired item describes a cluster the briefing no longer contains; there
  -- is nothing left to reconcile and nothing to decide.
  if v_item.status = 'retired' then
    raise exception 'caren_invalid_item';
  end if;

  -- Any evidence referenced must exist and belong to the same family — never
  -- trust an id supplied by the browser.
  if p_evidence_id is not null then
    select * into v_evidence from ma_caren_evidence where id = p_evidence_id;
    if not found or v_evidence.family_id <> v_item.family_id then
      raise exception 'caren_invalid_evidence';
    end if;
  end if;

  if p_action = 'confirm_candidate' then
    if v_item.status <> 'ambiguous' then
      raise exception 'caren_invalid_item';
    end if;
    if p_evidence_id is null or p_evidence_id is distinct from v_item.ambiguous_evidence_id then
      raise exception 'caren_invalid_evidence';
    end if;
    update ma_caren_expected_items set
      status                = 'seen',
      matched_evidence_id   = p_evidence_id,
      matched_content_hash  = v_item.content_hash,
      matched_at            = v_now,
      ambiguous_evidence_id = null,
      updated_at            = v_now
    where id = v_item.id
    returning * into v_item;
    v_decision := 'confirmed';

  elsif p_action = 'reject_candidate' then
    if v_item.status <> 'ambiguous' then
      raise exception 'caren_invalid_item';
    end if;
    if p_evidence_id is null or p_evidence_id is distinct from v_item.ambiguous_evidence_id then
      raise exception 'caren_invalid_evidence';
    end if;
    update ma_caren_expected_items set
      -- An older confirmed match against different content is still a fact:
      -- rejecting today's candidate returns the item to "Ma changed since
      -- Caren", not to "never seen".
      status                = case
                                when v_item.matched_content_hash is not null
                                 and v_item.matched_content_hash <> v_item.content_hash
                                then 'changed_after_seen'
                                else 'not_seen'
                              end,
      ambiguous_evidence_id = null,
      updated_at            = v_now
    where id = v_item.id
    returning * into v_item;
    v_decision := 'rejected';

  elsif p_action = 'manual_confirm' then
    -- "I looked in Caren myself." No evidence row is involved by definition.
    if p_evidence_id is not null then
      raise exception 'caren_invalid_evidence';
    end if;
    update ma_caren_expected_items set
      status                = 'manually_confirmed',
      matched_content_hash  = v_item.content_hash,
      manual_confirmed_by   = auth.uid(),
      manual_confirmed_at   = v_now,
      ambiguous_evidence_id = null,
      updated_at            = v_now
    where id = v_item.id
    returning * into v_item;
    v_decision := 'manual_confirmed';

  elsif p_action = 'reopen' then
    update ma_caren_expected_items set
      status                = 'not_seen',
      matched_evidence_id   = null,
      ambiguous_evidence_id = null,
      matched_content_hash  = null,
      matched_at            = null,
      manual_confirmed_by   = null,
      manual_confirmed_at   = null,
      updated_at            = v_now
    where id = v_item.id
    returning * into v_item;
    v_decision := 'reopened';

  else
    raise exception 'caren_invalid_action';
  end if;

  insert into ma_caren_match_reviews (family_id, expected_item_id, evidence_id, decision, decided_by, decided_at)
  values (v_item.family_id, v_item.id, p_evidence_id, v_decision, auth.uid(), v_now);

  return v_item;
end;
$$;

revoke all on function public.ma_review_caren_item(uuid, text, uuid) from public, anon;
grant execute on function public.ma_review_caren_item(uuid, text, uuid) to authenticated;
