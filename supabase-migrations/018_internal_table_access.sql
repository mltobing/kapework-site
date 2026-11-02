-- Emergency containment for internal metadata tables.
-- Public app clients must not access these tables. Existing owner/service_role
-- access is retained; no records, policies on other tables, or auth settings change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.internal_people enable row level security;
alter table public.internal_devices enable row level security;

revoke all privileges on table public.internal_people, public.internal_devices
  from public, anon, authenticated;

commit;
