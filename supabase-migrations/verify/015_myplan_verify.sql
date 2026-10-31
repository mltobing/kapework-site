-- VERIFICATION ONLY. Run the whole file as the migration administrator.
-- All fixtures are synthetic, all changes are rolled back, no account email
-- or existing schedule is read. Run against staging before production.
begin;

create temporary table myplan_verify_ids as
select gen_random_uuid() as owner_a, gen_random_uuid() as owner_b,
       gen_random_uuid() as schedule_id, gen_random_uuid() as photo_id;
grant select on myplan_verify_ids to authenticated, anon;

-- No password, email delivery, or real account is involved. The fixtures
-- exist only in this transaction to satisfy auth.users foreign keys.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select owner_a, 'authenticated', 'authenticated', 'myplan-verify-' || owner_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now() from myplan_verify_ids
union all
select owner_b, 'authenticated', 'authenticated', 'myplan-verify-' || owner_b || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now() from myplan_verify_ids;

create function pg_temp.myplan_expect(p_name text, p_ok boolean)
returns text language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'My Plan verification failed: %', p_name; end if;
  return 'PASS: ' || p_name;
end; $$;

select pg_temp.myplan_expect('RLS enabled',
  (select relrowsecurity from pg_class where oid = 'public.myplan_schedules'::regclass));
select pg_temp.myplan_expect('private photo bucket',
  (select not public from storage.buckets where id = 'myplan-photos'));
select pg_temp.myplan_expect('anonymous cannot execute save RPC',
  not has_function_privilege('anon', 'public.myplan_save_schedule(uuid,bigint,jsonb,boolean)', 'execute'));
select pg_temp.myplan_expect('authenticated cannot write table directly',
  not has_table_privilege('authenticated', 'public.myplan_schedules', 'insert')
  and not has_table_privilege('authenticated', 'public.myplan_schedules', 'update')
  and not has_table_privilege('authenticated', 'public.myplan_schedules', 'delete'));
select pg_temp.myplan_expect('document validator rejects missing print settings',
  public.myplan_document_valid(jsonb_build_object('id', schedule_id, 'title', 'Invalid',
    'steps', '[]'::jsonb, 'print', '{}'::jsonb, 'reward', null)) is not true)
from myplan_verify_ids;
select pg_temp.myplan_expect('picture validator rejects missing kind',
  public.myplan_picture_valid(jsonb_build_object('assetId', photo_id,
    'crop', jsonb_build_object('x', .5, 'y', .5, 'zoom', 1))) is not true)
from myplan_verify_ids;
select pg_temp.myplan_expect('picture validator rejects missing asset identifier',
  public.myplan_picture_valid(jsonb_build_object('kind', 'photo',
    'crop', jsonb_build_object('x', .5, 'y', .5, 'zoom', 1))) is not true);

select set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true) from myplan_verify_ids;
set local role authenticated;

select pg_temp.myplan_expect('owner can create schedule',
  (public.myplan_save_schedule(schedule_id, 0,
    jsonb_build_object('id', schedule_id, 'title', 'Synthetic routine', 'steps', '[]'::jsonb,
      'print', jsonb_build_object('paper', 'letter', 'theme', 'sage'), 'reward', null), false)->>'status') = 'saved')
from myplan_verify_ids;
select pg_temp.myplan_expect('owner can read schedule',
  (select count(*) = 1 from public.myplan_schedules where id = (select schedule_id from myplan_verify_ids)));

select pg_temp.myplan_expect('owner can update expected version',
  (public.myplan_save_schedule(schedule_id, 1,
    jsonb_build_object('id', schedule_id, 'title', 'Version two', 'steps', '[]'::jsonb,
      'print', jsonb_build_object('paper', 'letter', 'theme', 'sage'), 'reward', null), false)->>'status') = 'saved')
from myplan_verify_ids;
select pg_temp.myplan_expect('stale update returns conflict',
  (public.myplan_save_schedule(schedule_id, 1,
    jsonb_build_object('id', schedule_id, 'title', 'Stale edit', 'steps', '[]'::jsonb,
      'print', jsonb_build_object('paper', 'letter', 'theme', 'sage'), 'reward', null), false)->>'status') = 'conflict')
from myplan_verify_ids;
select pg_temp.myplan_expect('stale update did not overwrite newer row',
  (select document->>'title' = 'Version two' and version = 2 from public.myplan_schedules where id = (select schedule_id from myplan_verify_ids)));

-- Metadata-only storage objects exercise the same ownership policies as the
-- Storage API. No file is uploaded and no private object URL is created.
insert into storage.objects (bucket_id, name)
select 'myplan-photos', owner_a || '/assets/' || photo_id || '.jpg' from myplan_verify_ids;
select pg_temp.myplan_expect('owner can read own photo metadata',
  (select count(*) = 1 from storage.objects where bucket_id = 'myplan-photos'
    and name = (select owner_a || '/assets/' || photo_id || '.jpg' from myplan_verify_ids)));

reset role;
select set_config('request.jwt.claims', json_build_object('sub', owner_b, 'role', 'authenticated')::text, true) from myplan_verify_ids;
set local role authenticated;

select pg_temp.myplan_expect('second account cannot read schedule',
  (select count(*) = 0 from public.myplan_schedules where id = (select schedule_id from myplan_verify_ids)));
select pg_temp.myplan_expect('second account cannot read photo metadata',
  (select count(*) = 0 from storage.objects where bucket_id = 'myplan-photos'
    and name = (select owner_a || '/assets/' || photo_id || '.jpg' from myplan_verify_ids)));
do $$
declare denied boolean := false; fixture record; result jsonb;
begin
  select * into fixture from myplan_verify_ids;
  begin
    result := public.myplan_save_schedule(fixture.schedule_id, 2,
      jsonb_build_object('id', fixture.schedule_id, 'title', 'Wrong owner', 'steps', '[]'::jsonb,
        'print', jsonb_build_object('paper', 'letter', 'theme', 'sage'), 'reward', null), false);
    denied := result->>'status' = 'conflict' and result->'row' = 'null'::jsonb;
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.myplan_expect('second account cannot overwrite schedule', denied);
  denied := false;
  begin
    insert into storage.objects (bucket_id, name) values
      ('myplan-photos', fixture.owner_a || '/assets/' || gen_random_uuid() || '.jpg');
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.myplan_expect('second account cannot upload into owner folder', denied);
end; $$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare blocked boolean := false; n bigint;
begin
  begin
    select count(*) into n from public.myplan_schedules where id = (select schedule_id from myplan_verify_ids);
    blocked := n = 0;
  exception when insufficient_privilege then blocked := true;
  end;
  perform pg_temp.myplan_expect('unauthenticated cannot read schedule', blocked);
  blocked := false;
  begin
    select count(*) into n from storage.objects where bucket_id = 'myplan-photos'
      and name = (select owner_a || '/assets/' || photo_id || '.jpg' from myplan_verify_ids);
    blocked := n = 0;
  exception when insufficient_privilege then blocked := true;
  end;
  perform pg_temp.myplan_expect('unauthenticated cannot read photo metadata', blocked);
end; $$;

reset role;
select 'PASS: My Plan owner/other-account/anonymous access and optimistic concurrency verified; fixtures rolled back' as verification;
rollback;
