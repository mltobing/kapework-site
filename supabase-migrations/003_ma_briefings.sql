-- 003_ma_briefings.sql — idempotent; reflects live schema
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
  on ma_briefings (family_id, briefing_date desc);

alter table ma_briefings enable row level security;

drop policy if exists briefings_select on ma_briefings;
create policy briefings_select on ma_briefings for select
  using (ma_is_family_member(family_id));

drop policy if exists briefings_update on ma_briefings;
create policy briefings_update on ma_briefings for update
  using (ma_is_family_member(family_id))
  with check (ma_is_family_member(family_id));

create or replace function ma_briefings_guard_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.caren_text    is distinct from old.caren_text
  or new.whatsapp_text is distinct from old.whatsapp_text
  or new.source_hash   is distinct from old.source_hash
  or new.generated_at  is distinct from old.generated_at
  or new.family_id     is distinct from old.family_id
  or new.briefing_date is distinct from old.briefing_date then
    raise exception 'ma_briefings: generated payload is service-role only';
  end if;
  return new;
end; $$;

drop trigger if exists ma_briefings_guard_columns_trg on ma_briefings;
create trigger ma_briefings_guard_columns_trg
  before update on ma_briefings
  for each row execute function ma_briefings_guard_columns();
