-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — ma_briefings
-- Run in: Supabase project → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Daily generated briefing texts for the "Met Irma" pipeline.
-- One row per (family, date): a Caren cluster line + a WhatsApp reminder draft.
--
-- Writes (inserts and text updates) come ONLY from the private irma-sync job
-- using the service role key. Family members may read every row and flip the
-- "sent" status, but may never alter the generated texts — enforced by RLS
-- (no member insert/delete policy) plus the immutability trigger below.

create table if not exists ma_briefings (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references ma_families(id) on delete cascade,
  briefing_date date not null,
  caren_text    text,
  whatsapp_text text,
  source_hash   text not null,
  status        text not null default 'ready'
                check (status in ('ready','sent','changed_after_sent')),
  sent_at       timestamptz,
  sent_by       uuid references ma_profiles(user_id),
  generated_at  timestamptz not null default now(),
  unique (family_id, briefing_date)
);

create index if not exists ma_briefings_family_date_idx
  on ma_briefings (family_id, briefing_date);

alter table ma_briefings enable row level security;

-- Read: any member of the family (mirrors the ma_calendar_events policy pattern).
create policy briefings_select on ma_briefings for select using (
  exists (select 1 from ma_family_members m
          where m.family_id = ma_briefings.family_id
            and m.user_id = auth.uid())
);

-- Update: members may flip status / sent fields only. Column-level immutability
-- for the generated texts is enforced by the trigger below (a with-check clause
-- cannot compare against OLD, so the guard lives in a trigger).
create policy briefings_update on ma_briefings for update using (
  exists (select 1 from ma_family_members m
          where m.family_id = ma_briefings.family_id
            and m.user_id = auth.uid())
) with check (true);

-- No member insert/delete policy: those paths are service-role-only.

-- ─── Column immutability guard ───────────────────────────────────────────────
-- The service role bypasses RLS and carries no auth.uid(); it may change any
-- column. Authenticated members (auth.uid() is not null) may touch only the
-- status / sent_at / sent_by columns — any attempt to alter the generated
-- texts, hash, provenance, date, or family ownership is rejected.
create or replace function ma_briefings_guard_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.caren_text    is distinct from old.caren_text
       or new.whatsapp_text is distinct from old.whatsapp_text
       or new.source_hash   is distinct from old.source_hash
       or new.generated_at  is distinct from old.generated_at
       or new.briefing_date is distinct from old.briefing_date
       or new.family_id     is distinct from old.family_id then
      raise exception
        'ma_briefings: members may only change status and sent fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ma_briefings_protect_columns on ma_briefings;
create trigger ma_briefings_protect_columns
  before update on ma_briefings
  for each row
  execute function ma_briefings_guard_protected_columns();

-- ─── ma_calendar_events: UID the sync job upserts on ─────────────────────────
-- The irma-sync job keys its upserts on the iCal UID. Ensure the column it
-- writes to exists and is unique. (An older column `external_event_uid` may be
-- present from earlier docs; the sync contract standardises on `external_uid`.)
alter table ma_calendar_events
  add column if not exists external_uid text;

create unique index if not exists ma_calendar_events_external_uid_key
  on ma_calendar_events (external_uid);
