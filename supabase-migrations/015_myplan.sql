-- My Plan: independent account-owned schedules and photos. No Ma membership grants.
-- Apply through the normal migration pipeline before enabling account sync.
begin;

create or replace function public.myplan_picture_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or not(p ? 'kind') then return false; end if;
  if p->>'kind' = 'illustration' then
    return p->>'id' = any(array['wake','relax','school','teeth','clothes','bag','shoes','leave',
      'socks','hands','unpack','homework','play','dinner','bath','pajamas','bed','read',
      'prayers','sleep','star','heart','water'])
      and not exists(select 1 from jsonb_object_keys(p) k where k not in ('kind','id'));
  end if;
  if p->>'kind' is distinct from 'photo' or not(p ?& array['kind','assetId','crop']) or jsonb_typeof(p->'assetId') is distinct from 'string' or p->>'assetId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'crop') <> 'object' then return false; end if;
  return jsonb_typeof(p->'crop'->'x') = 'number' and jsonb_typeof(p->'crop'->'y') = 'number'
    and jsonb_typeof(p->'crop'->'zoom') = 'number'
    and (p->'crop'->>'x')::numeric between 0 and 1
    and (p->'crop'->>'y')::numeric between 0 and 1
    and (p->'crop'->>'zoom')::numeric between 1 and 3
    and not exists(select 1 from jsonb_object_keys(p) k where k not in ('kind','assetId','crop'))
    and not exists(select 1 from jsonb_object_keys(p->'crop') k where k not in ('x','y','zoom'));
exception when others then return false;
end $$;

create or replace function public.myplan_document_valid(d jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare s jsonb; step_ids text[] := array[]::text[];
begin
  if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text) > 100000
    or jsonb_typeof(d->'id') <> 'string' or d->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(d->'title') <> 'string' or length(d->>'title') > 80
    or jsonb_typeof(d->'steps') <> 'array' or jsonb_array_length(d->'steps') > 24
    or jsonb_typeof(d->'print') <> 'object' or not(d->'print' ?& array['paper','theme'])
    or jsonb_typeof(d->'print'->'paper') is distinct from 'string'
    or jsonb_typeof(d->'print'->'theme') is distinct from 'string'
    or d->'print'->>'paper' not in ('letter','tabloid')
    or d->'print'->>'theme' not in ('sage','peach','sky')
    or not (d ?& array['id','title','steps','reward','print'])
    or exists(select 1 from jsonb_object_keys(d) k where k not in ('id','title','steps','reward','print'))
    or exists(select 1 from jsonb_object_keys(d->'print') k where k not in ('paper','theme')) then return false; end if;
  for s in select value from jsonb_array_elements(d->'steps') loop
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(s->'id') <> 'string'
      or s->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or s->>'id' = any(step_ids) or not(s ?& array['id','label','caption','picture'])
      or jsonb_typeof(s->'label') <> 'string' or length(s->>'label') > 60
      or jsonb_typeof(s->'caption') <> 'string' or length(s->>'caption') > 140
      or not coalesce(public.myplan_picture_valid(s->'picture'),false)
      or exists(select 1 from jsonb_object_keys(s) k where k not in ('id','label','caption','picture')) then return false; end if;
    step_ids := array_append(step_ids,s->>'id');
  end loop;
  s := d->'reward';
  if s <> 'null'::jsonb then
    if jsonb_typeof(s) <> 'object' or not(s ?& array['label','caption','picture'])
      or jsonb_typeof(s->'label') <> 'string' or length(s->>'label') > 60
      or jsonb_typeof(s->'caption') <> 'string' or length(s->>'caption') > 140
      or not coalesce(public.myplan_picture_valid(s->'picture'),false)
      or exists(select 1 from jsonb_object_keys(s) k where k not in ('label','caption','picture')) then return false; end if;
  end if;
  return true;
exception when others then return false;
end $$;

create table public.myplan_schedules (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  document jsonb not null,
  version bigint not null default 1 check (version > 0),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint myplan_document_valid check (public.myplan_document_valid(document) is true),
  constraint myplan_document_id_matches check (document->>'id' = id::text)
);
create index myplan_schedules_owner_updated on public.myplan_schedules(owner_id,updated_at desc);
alter table public.myplan_schedules enable row level security;
alter table public.myplan_schedules force row level security;
create policy myplan_owner_read on public.myplan_schedules for select to authenticated
  using (owner_id = (select auth.uid()));
-- Clients read their own rows; all mutations go through the CAS RPC below.
revoke all on public.myplan_schedules from public,anon,authenticated;
grant select on public.myplan_schedules to authenticated;
grant all on public.myplan_schedules to service_role;

create or replace function public.myplan_save_schedule(
  p_id uuid, p_base_version bigint, p_document jsonb, p_deleted boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid(); current_row public.myplan_schedules; saved_row public.myplan_schedules;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_base_version is null or p_base_version < 0 or p_deleted is null
    or not coalesce(public.myplan_document_valid(p_document),false)
    or p_document->>'id' <> p_id::text then
    raise exception 'Invalid schedule' using errcode='22023';
  end if;
  if p_base_version = 0 then
    insert into public.myplan_schedules(id,owner_id,document,deleted)
      values(p_id,owner,p_document,p_deleted)
      on conflict(id) do nothing returning * into saved_row;
    if found then return jsonb_build_object('status','saved','row',to_jsonb(saved_row) - 'owner_id'); end if;
  end if;
  select * into current_row from public.myplan_schedules where id=p_id and owner_id=owner for update;
  if not found then
    -- Never disclose a row belonging to another account (including UUID collisions).
    return jsonb_build_object('status','conflict','row',null);
  end if;
  if current_row.version <> p_base_version then
    return jsonb_build_object('status','conflict','row',to_jsonb(current_row) - 'owner_id');
  end if;
  update public.myplan_schedules set document=p_document,deleted=p_deleted,
    version=version+1,updated_at=clock_timestamp()
    where id=p_id and owner_id=owner returning * into saved_row;
  return jsonb_build_object('status','saved','row',to_jsonb(saved_row) - 'owner_id');
end $$;
revoke all on function public.myplan_save_schedule(uuid,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.myplan_save_schedule(uuid,bigint,jsonb,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('myplan-photos','myplan-photos',false,5242880,array['image/jpeg']);

-- Restrictive fences prevent any present/future broad permissive bucket policy
-- from accidentally granting other accounts or visitors access to My Plan files.
create policy myplan_photo_fence on storage.objects as restrictive for all to public
  using (bucket_id <> 'myplan-photos' or ((select auth.uid()) is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text))
  with check (bucket_id <> 'myplan-photos' or ((select auth.uid()) is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text));
create policy myplan_photo_read on storage.objects for select to authenticated
  using (bucket_id='myplan-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy myplan_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id='myplan-photos'
    and name ~ ('^' || (select auth.uid())::text || '/assets/[0-9a-f-]{36}\.jpg$'));
create policy myplan_photo_delete on storage.objects for delete to authenticated
  using (bucket_id='myplan-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Photos are immutable; replacing/recropping creates a new image or changes only
-- the schedule crop. No UPDATE permission is granted by this migration.

comment on table public.myplan_schedules is 'Private reusable routines. Versioned CAS writes; deleted rows are tombstones for offline conflict detection.';
commit;
