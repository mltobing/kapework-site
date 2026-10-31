-- Keep Ma invitation-only when general Kapework account registration expands.
-- Requires the existing Ma schema and migrations 005, 006, and 008.
-- This does not create family/care-team grants or change any user's membership.
begin;

-- Attach this function as Auth's Before User Created hook BEFORE enabling
-- global signups. Only Auth sets app_metadata.provider; user_metadata is
-- deliberately ignored. Existing email/password and magic-link users do not
-- run a creation hook when they sign in. New email invitations are blocked;
-- exceptional email users must be precreated through the privileged Admin API.
create or replace function public.kapework_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if event->'user'->'app_metadata'->>'provider' = 'google' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Use Google to create a Kapework account. Existing accounts can still sign in with email.'
  ));
end;
$$;

revoke all on function public.kapework_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.kapework_before_user_created(jsonb) to supabase_auth_admin;

-- Revoking just anon/authenticated leaves PostgreSQL's default PUBLIC grant in
-- effect. Retention and pairing cleanup are service maintenance operations.
revoke all on function public.ma_cleanup_device_rows() from public, anon, authenticated;
revoke all on function public.ma_cleanup_trashed_logboek_entries() from public, anon, authenticated;
grant execute on function public.ma_cleanup_device_rows() to service_role;
grant execute on function public.ma_cleanup_trashed_logboek_entries() to service_role;

-- Account existence alone does not confer any Ma access. Membership can be
-- granted before a profile exists (membership references auth.users directly).
create or replace function public.ma_has_access()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.ma_family_members m where m.user_id = auth.uid())
    or exists (
      select 1 from public.ma_care_team_members m
      where m.user_id = auth.uid() and m.revoked_at is null
    )
  );
$$;

revoke all on function public.ma_has_access() from public, anon;
grant execute on function public.ma_has_access() to authenticated, service_role;

drop policy if exists "ma_profiles: insert own" on public.ma_profiles;
create policy "ma_profiles: insert own" on public.ma_profiles
for insert to authenticated
with check (user_id = auth.uid() and public.ma_has_access());

drop policy if exists "ma_profiles: update own" on public.ma_profiles;
create policy "ma_profiles: update own" on public.ma_profiles
for update to authenticated
using (user_id = auth.uid() and public.ma_has_access())
with check (user_id = auth.uid() and public.ma_has_access());

-- SECURITY DEFINER mutations must check current access as well as authorship.
-- A removed family member or revoked caregiver must lose mutation privileges
-- even for entries that they originally wrote. Owners retain their override.
create or replace function public.ma_trash_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.ma_posts%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_post from public.ma_posts
    where id = p_post_id and deleted_at is null for update;
  if not found then return false; end if;
  if not (
    public.ma_is_family_owner(v_post.family_id)
    or (v_post.author_id = auth.uid() and (
      public.ma_is_family_member(v_post.family_id)
      or (v_post.audience = 'care_team' and public.ma_is_care_team_member(v_post.family_id))
    ))
  ) then return false; end if;
  update public.ma_posts set deleted_at = now(), deleted_by = auth.uid()
    where id = p_post_id;
  return true;
end;
$$;

create or replace function public.ma_restore_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.ma_posts%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_post from public.ma_posts
    where id = p_post_id and deleted_at is not null for update;
  if not found then return false; end if;
  if not (
    public.ma_is_family_owner(v_post.family_id)
    or (v_post.author_id = auth.uid() and (
      public.ma_is_family_member(v_post.family_id)
      or (v_post.audience = 'care_team' and public.ma_is_care_team_member(v_post.family_id))
    ))
  ) then return false; end if;
  update public.ma_posts set deleted_at = null, deleted_by = null where id = p_post_id;
  return true;
end;
$$;

-- Preserve failed-upload cleanup for an active author of a nontrashed entry;
-- permanent deletion of a trashed entry remains owner-only.
create or replace function public.ma_permanently_delete_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_post public.ma_posts%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_post from public.ma_posts where id = p_post_id for update;
  if not found then return false; end if;
  if not (
    public.ma_is_family_owner(v_post.family_id)
    or (v_post.author_id = auth.uid() and v_post.deleted_at is null and (
      public.ma_is_family_member(v_post.family_id)
      or (v_post.audience = 'care_team' and public.ma_is_care_team_member(v_post.family_id))
    ))
  ) then return false; end if;
  delete from public.ma_posts where id = p_post_id;
  return true;
end;
$$;

revoke all on function public.ma_trash_logboek_entry(uuid) from public, anon;
revoke all on function public.ma_restore_logboek_entry(uuid) from public, anon;
revoke all on function public.ma_permanently_delete_logboek_entry(uuid) from public, anon;
grant execute on function public.ma_trash_logboek_entry(uuid) to authenticated;
grant execute on function public.ma_restore_logboek_entry(uuid) to authenticated;
grant execute on function public.ma_permanently_delete_logboek_entry(uuid) to authenticated;

commit;
