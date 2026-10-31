-- Run the WHOLE file as the migration administrator in staging after 016.
-- Synthetic users/metadata only, no email, no files, no production row reads.
-- All fixtures roll back; cleanup functions are checked but NEVER invoked.
begin;

create temporary table ma_access_verify_ids as
select gen_random_uuid() as family_id, gen_random_uuid() as owner_id,
  gen_random_uuid() as member_id, gen_random_uuid() as caregiver_id,
  gen_random_uuid() as revoked_id, gen_random_uuid() as removed_id,
  gen_random_uuid() as outsider_id, gen_random_uuid() as owner_post,
  gen_random_uuid() as member_post, gen_random_uuid() as caregiver_post,
  gen_random_uuid() as caregiver_family_post, gen_random_uuid() as revoked_post,
  gen_random_uuid() as revoked_trash, gen_random_uuid() as removed_post,
  gen_random_uuid() as removed_trash;
grant select on ma_access_verify_ids to authenticated, anon;

create function pg_temp.ma_expect(p_name text, p_ok boolean)
returns text language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'Ma access verification failed: %', p_name; end if;
  return 'PASS: ' || p_name;
end; $$;

select pg_temp.ma_expect('maintenance cannot run as anonymous or general account',
  not has_function_privilege('anon', 'public.ma_cleanup_device_rows()', 'execute')
  and not has_function_privilege('authenticated', 'public.ma_cleanup_device_rows()', 'execute')
  and not has_function_privilege('anon', 'public.ma_cleanup_trashed_logboek_entries()', 'execute')
  and not has_function_privilege('authenticated', 'public.ma_cleanup_trashed_logboek_entries()', 'execute'));
select pg_temp.ma_expect('maintenance remains available to service role',
  has_function_privilege('service_role', 'public.ma_cleanup_device_rows()', 'execute')
  and has_function_privilege('service_role', 'public.ma_cleanup_trashed_logboek_entries()', 'execute'));
select pg_temp.ma_expect('signup hook is only callable by Auth',
  has_function_privilege('supabase_auth_admin', 'public.kapework_before_user_created(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.kapework_before_user_created(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.kapework_before_user_created(jsonb)', 'execute'));
set local role supabase_auth_admin;
select pg_temp.ma_expect('new Google account is allowed',
  public.kapework_before_user_created('{"user":{"app_metadata":{"provider":"google"}}}') = '{}'::jsonb);
select pg_temp.ma_expect('new email account is blocked even with spoofed user metadata',
  (public.kapework_before_user_created('{"user":{"app_metadata":{"provider":"email"},"user_metadata":{"provider":"google"}}}')->'error'->>'http_code') = '403');
select pg_temp.ma_expect('missing provider fails closed',
  (public.kapework_before_user_created('{}')->'error'->>'http_code') = '403');
reset role;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u.id, 'authenticated', 'authenticated', 'ma-access-verify-' || u.id || '@example.invalid',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb, now(), now()
from ma_access_verify_ids f cross join lateral unnest(array[
  f.owner_id,f.member_id,f.caregiver_id,f.revoked_id,f.removed_id,f.outsider_id]) as u(id);

insert into public.ma_families(id,name) select family_id,'Synthetic access verification' from ma_access_verify_ids;
insert into public.ma_profiles(user_id,display_name)
select u.id,'Synthetic profile' from ma_access_verify_ids f
cross join lateral unnest(array[f.owner_id,f.member_id,f.revoked_id,f.removed_id]) as u(id);
insert into public.ma_family_members(family_id,user_id,role)
select family_id,owner_id,'owner' from ma_access_verify_ids
union all select family_id,member_id,'member' from ma_access_verify_ids
union all select family_id,removed_id,'member' from ma_access_verify_ids;
insert into public.ma_care_team_members(family_id,user_id,created_by,revoked_at,revoked_by)
select family_id,caregiver_id,owner_id,null::timestamptz,null::uuid from ma_access_verify_ids
union all select family_id,revoked_id,owner_id,now(),owner_id from ma_access_verify_ids;
delete from public.ma_family_members where user_id = (select removed_id from ma_access_verify_ids);

-- A new granted caregiver can create a profile; no profile is required to grant
-- membership. This exercises the intended onboarding order after the UI gate.
select set_config('request.jwt.claims',json_build_object('sub',caregiver_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('active caregiver has access',public.ma_has_access());
insert into public.ma_profiles(user_id,display_name) select caregiver_id,'Synthetic caregiver' from ma_access_verify_ids;
update public.ma_profiles set display_name='Synthetic caregiver edited' where user_id=(select caregiver_id from ma_access_verify_ids);
select pg_temp.ma_expect('active caregiver can insert and update own profile',
  (select display_name='Synthetic caregiver edited' from public.ma_profiles where user_id=(select caregiver_id from ma_access_verify_ids)));
reset role;

insert into public.ma_posts(id,family_id,author_id,kind,audience,body,deleted_at,deleted_by)
select owner_post,family_id,owner_id,'note','family','Synthetic',null::timestamptz,null::uuid from ma_access_verify_ids
union all select member_post,family_id,member_id,'note','family','Synthetic',null,null from ma_access_verify_ids
union all select caregiver_post,family_id,caregiver_id,'note','care_team','Synthetic',null,null from ma_access_verify_ids
union all select caregiver_family_post,family_id,caregiver_id,'note','family','Synthetic',null,null from ma_access_verify_ids
union all select revoked_post,family_id,revoked_id,'note','care_team','Synthetic',null,null from ma_access_verify_ids
union all select revoked_trash,family_id,revoked_id,'note','care_team','Synthetic',now(),owner_id from ma_access_verify_ids
union all select removed_post,family_id,removed_id,'note','family','Synthetic',null,null from ma_access_verify_ids
union all select removed_trash,family_id,removed_id,'note','family','Synthetic',now(),owner_id from ma_access_verify_ids;
insert into storage.objects(bucket_id,name)
select 'ma-media',family_id || '/' || owner_post || '/synthetic.jpg' from ma_access_verify_ids;

-- General Google account without an explicit Ma grant.
select set_config('request.jwt.claims',json_build_object('sub',outsider_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('general account has no Ma access',not public.ma_has_access());
select pg_temp.ma_expect('general account cannot read Ma family or post',
  not exists(select 1 from public.ma_families where id=(select family_id from ma_access_verify_ids))
  and not exists(select 1 from public.ma_posts where family_id=(select family_id from ma_access_verify_ids)));
select pg_temp.ma_expect('general account cannot read Ma photo metadata',
  not exists(select 1 from storage.objects where bucket_id='ma-media'
    and name=(select family_id || '/' || owner_post || '/synthetic.jpg' from ma_access_verify_ids)));
select pg_temp.ma_expect('general account cannot mutate Ma entries through RPC',
  not public.ma_trash_logboek_entry(owner_post)
  and not public.ma_restore_logboek_entry(revoked_trash)
  and not public.ma_permanently_delete_logboek_entry(owner_post)) from ma_access_verify_ids;
do $$
declare denied boolean := false;
begin
  begin
    insert into public.ma_profiles(user_id,display_name) select outsider_id,'Not granted' from ma_access_verify_ids;
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.ma_expect('general account cannot create Ma profile',denied);
  denied := false;
  begin
    insert into public.ma_family_members(family_id,user_id,role) select family_id,outsider_id,'owner' from ma_access_verify_ids;
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.ma_expect('general account cannot grant itself Ma access',denied);
end; $$;
reset role;

-- Retained author IDs are not access grants after membership removal/revocation.
select set_config('request.jwt.claims',json_build_object('sub',revoked_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('revoked caregiver has no access',not public.ma_has_access());
select pg_temp.ma_expect('revoked caregiver cannot trash restore or delete former entries',
  not public.ma_trash_logboek_entry(revoked_post)
  and not public.ma_restore_logboek_entry(revoked_trash)
  and not public.ma_permanently_delete_logboek_entry(revoked_post)) from ma_access_verify_ids;
do $$
declare affected integer;
begin
  update public.ma_profiles set display_name='Unauthorized edit' where user_id=(select revoked_id from ma_access_verify_ids);
  get diagnostics affected = row_count;
  perform pg_temp.ma_expect('revoked caregiver cannot update profile',affected=0);
end; $$;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',removed_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('removed family member has no access',not public.ma_has_access());
select pg_temp.ma_expect('removed member cannot trash restore or delete former entries',
  not public.ma_trash_logboek_entry(removed_post)
  and not public.ma_restore_logboek_entry(removed_trash)
  and not public.ma_permanently_delete_logboek_entry(removed_post)) from ma_access_verify_ids;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',caregiver_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('active caregiver cannot mutate family-only entries even if author',
  not public.ma_trash_logboek_entry(caregiver_family_post)
  and not public.ma_permanently_delete_logboek_entry(caregiver_family_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('active caregiver cannot mutate another author entry',
  not public.ma_trash_logboek_entry(revoked_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('active caregiver can trash own care-team entry',
  public.ma_trash_logboek_entry(caregiver_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('active caregiver cannot permanently delete trashed entry',
  not public.ma_permanently_delete_logboek_entry(caregiver_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('active caregiver can restore own care-team entry',
  public.ma_restore_logboek_entry(caregiver_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('active caregiver retains failed-upload cleanup for own nontrashed entry',
  public.ma_permanently_delete_logboek_entry(caregiver_post)) from ma_access_verify_ids;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',member_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('family member retains access',public.ma_has_access());
select pg_temp.ma_expect('member cannot trash another author entry',not public.ma_trash_logboek_entry(owner_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('member can trash own family entry',public.ma_trash_logboek_entry(member_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('member can restore own family entry',public.ma_restore_logboek_entry(member_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('member retains failed-upload cleanup',public.ma_permanently_delete_logboek_entry(member_post)) from ma_access_verify_ids;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) from ma_access_verify_ids;
set local role authenticated;
select pg_temp.ma_expect('owner retains access',public.ma_has_access());
select pg_temp.ma_expect('owner can trash another author entry',public.ma_trash_logboek_entry(revoked_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('owner can restore another author entry',public.ma_restore_logboek_entry(revoked_post)) from ma_access_verify_ids;
select pg_temp.ma_expect('owner can permanently delete another author trashed entry',public.ma_permanently_delete_logboek_entry(revoked_trash)) from ma_access_verify_ids;
reset role;

select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.ma_expect('anonymous cannot execute Ma access or mutation helpers',
  not has_function_privilege('anon','public.ma_has_access()','execute')
  and not has_function_privilege('anon','public.ma_trash_logboek_entry(uuid)','execute')
  and not has_function_privilege('anon','public.ma_restore_logboek_entry(uuid)','execute')
  and not has_function_privilege('anon','public.ma_permanently_delete_logboek_entry(uuid)','execute'));
select pg_temp.ma_expect('anonymous cannot read synthetic Ma content',
  not exists(select 1 from public.ma_posts where family_id=(select family_id from ma_access_verify_ids)));
reset role;

rollback;
