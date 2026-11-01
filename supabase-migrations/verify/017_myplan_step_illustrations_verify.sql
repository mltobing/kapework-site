-- Run after 017. Validator-only checks: no account, schedule or storage writes.
-- Temporary test objects and all changes are rolled back in this transaction.
begin;

create function pg_temp.myplan_illustration_expect(p_name text, actual boolean, expected boolean)
returns text language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'My Plan illustration verification failed: %',p_name;
  end if;
  return p_name;
end; $$;

create temporary table myplan_illustration_cases(name text,actual boolean,expected boolean);
with pictures as (
  select '{"kind":"photo","assetId":"00000000-0000-4000-8000-000000000001","crop":{"x":0.2,"y":0.8,"zoom":2}}'::jsonb as legacy
), cases(name,picture,expected) as (
  select 'legacy photo stays valid',legacy,true from pictures
  union all select 'photo plus illustration',legacy || '{"illustrationId":"teeth"}',true from pictures
  union all select 'photo plus last known illustration',legacy || '{"illustrationId":"water"}',true from pictures
  union all select 'null illustration rejected',legacy || '{"illustrationId":null}',false from pictures
  union all select 'unknown illustration rejected',legacy || '{"illustrationId":"unknown"}',false from pictures
  union all select 'empty illustration rejected',legacy || '{"illustrationId":""}',false from pictures
  union all select 'number illustration rejected',legacy || '{"illustrationId":3}',false from pictures
  union all select 'object illustration rejected',legacy || '{"illustrationId":{"id":"teeth"}}',false from pictures
  union all select 'array illustration rejected',legacy || '{"illustrationId":["teeth"]}',false from pictures
  union all select 'photo unknown field rejected',legacy || '{"illustrationId":"teeth","url":"https://invalid.example/photo"}',false from pictures
  union all select 'photo missing crop rejected',legacy - 'crop',false from pictures
  union all select 'photo null crop rejected',legacy || '{"crop":null}',false from pictures
  union all select 'photo crop missing coordinate rejected',legacy || '{"crop":{"x":0.5,"zoom":1}}',false from pictures
  union all select 'photo crop unknown field rejected',legacy || '{"crop":{"x":0.5,"y":0.5,"zoom":1,"angle":90}}',false from pictures
  union all select 'photo crop outside bounds rejected',legacy || '{"crop":{"x":-0.1,"y":0.5,"zoom":1}}',false from pictures
  union all select 'photo crop numeric string rejected',legacy || '{"crop":{"x":"0.5","y":0.5,"zoom":1}}',false from pictures
  union all select 'photo invalid asset rejected',legacy || '{"assetId":"invalid"}',false from pictures
  union all select 'illustration without photo stays valid','{"kind":"illustration","id":"teeth"}',true
  union all select 'illustration missing id rejected','{"kind":"illustration"}',false
  union all select 'illustration cannot carry photo addon','{"kind":"illustration","id":"teeth","illustrationId":"water"}',false
  union all select 'unknown kind rejected','{"kind":"video","id":"teeth"}',false
  union all select 'null picture rejected','null',false
  union all select 'missing picture rejected',null::jsonb,false
)
insert into myplan_illustration_cases
select name,public.myplan_picture_valid(picture),expected from cases;

with document as (
  select '{"id":"00000000-0000-4000-8000-000000000002","title":"Synthetic routine","steps":[{"id":"00000000-0000-4000-8000-000000000003","label":"Brush teeth","caption":"","picture":{"kind":"photo","assetId":"00000000-0000-4000-8000-000000000001","crop":{"x":0.2,"y":0.8,"zoom":2}}}],"reward":null,"print":{"paper":"letter","theme":"sage"}}'::jsonb as old
), expanded as (
  select old,jsonb_set(old,'{steps,0,picture,illustrationId}','"teeth"') as updated from document
)
insert into myplan_illustration_cases
select 'legacy whole document stays valid',public.myplan_document_valid(old),true from expanded
union all select 'step photo plus illustration document valid',public.myplan_document_valid(updated),true from expanded
union all select 'reward photo plus illustration document valid',public.myplan_document_valid(jsonb_set(updated,'{reward}',
  jsonb_build_object('label','Together time','caption','When we finish','picture',updated#>'{steps,0,picture}'))),true from expanded
union all select 'document rejects invalid illustration',public.myplan_document_valid(jsonb_set(updated,'{steps,0,picture,illustrationId}','"unknown"')),false from expanded;

select count(*) as assertions,
  array_agg(pg_temp.myplan_illustration_expect(name,actual,expected) order by name) as passed
from myplan_illustration_cases;

rollback;
