-- My Plan keeps a recognizable illustration beside an optional photograph.
-- Existing photo documents without illustrationId remain valid. This only
-- extends validation: no records, photo objects, ownership or RLS are changed.
begin;

create or replace function public.myplan_picture_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  valid_illustrations constant text[] := array[
    'wake','relax','school','teeth','clothes','bag','shoes','leave','socks','hands',
    'unpack','homework','play','dinner','bath','pajamas','bed','read','prayers',
    'sleep','star','heart','water'
  ];
begin
  if jsonb_typeof(p) is distinct from 'object' or not(p ? 'kind') then return false; end if;
  if p->>'kind' = 'illustration' then
    return coalesce(jsonb_typeof(p->'id') = 'string'
      and p->>'id' = any(valid_illustrations)
      and not exists(select 1 from jsonb_object_keys(p) k where k not in ('kind','id')),false);
  end if;
  if p->>'kind' is distinct from 'photo'
    or not(p ?& array['kind','assetId','crop'])
    or jsonb_typeof(p->'assetId') is distinct from 'string'
    or p->>'assetId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'crop') is distinct from 'object' then return false; end if;
  if p ? 'illustrationId' and (
    jsonb_typeof(p->'illustrationId') is distinct from 'string'
    or (p->>'illustrationId' = any(valid_illustrations)) is distinct from true
  ) then return false; end if;
  return coalesce(jsonb_typeof(p->'crop'->'x') = 'number'
    and jsonb_typeof(p->'crop'->'y') = 'number'
    and jsonb_typeof(p->'crop'->'zoom') = 'number'
    and (p->'crop'->>'x')::numeric between 0 and 1
    and (p->'crop'->>'y')::numeric between 0 and 1
    and (p->'crop'->>'zoom')::numeric between 1 and 3
    and not exists(select 1 from jsonb_object_keys(p) k where k not in ('kind','assetId','crop','illustrationId'))
    and not exists(select 1 from jsonb_object_keys(p->'crop') k where k not in ('x','y','zoom')),false);
exception when others then return false;
end $$;

commit;
