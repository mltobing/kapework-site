-- 008_ma_logboek_trash.sql — idempotent; reflects intended live schema
--
-- Logboek edit / soft-delete / restore / owner trash management.
--
-- Every ma_posts row today is a manually-created Logboek entry — there is no
-- service-role writer for this table (unlike ma_calendar_events / ma_briefings /
-- ma_ride_notices, which the private irma-sync job owns). That means the
-- "never silently delete a calendar-synced or system-generated record" concern
-- from the brief does not require a kind-based carve-out here: this soft-delete
-- flow safely applies to every ma_posts row as it exists today. If a
-- service-role-authored kind is ever introduced, exclude it explicitly then.
--
-- Soft delete: deleted_at/deleted_by are just ordinary columns on the same
-- row. SELECT is tightened below so only the owner may read a trashed
-- (deleted_at IS NOT NULL) row — a plain member/caregiver must not see one at
-- all, not just "the normal feed hides it" client-side. This backs the
-- owner-only Prullenbak view in Beheer.
--
-- That tightened SELECT policy is exactly why trash/restore/permanent-delete
-- must go through SECURITY DEFINER RPCs (ma_trash_logboek_entry() etc, part
-- E below) rather than a plain client-side `.update()`/`.delete()` against
-- a row-level UPDATE/DELETE policy: PostgreSQL requires the *post-update* row
-- to still satisfy the table's SELECT policy for the executing role, even
-- with no RETURNING clause. A non-owner author soft-deleting their own entry
-- makes it invisible under the owner-only-trash SELECT policy — so a raw
-- `UPDATE ... SET deleted_at = now()` from that author is flatly rejected
-- ("new row violates row-level security policy"), not silently hidden
-- afterward as you might expect. Routing the mutation through a SECURITY
-- DEFINER function sidesteps this entirely (the function runs with the
-- function owner's privileges, bypassing RLS) while the function body itself
-- enforces the exact same author-or-owner rule explicitly — the same
-- pattern already used for ma_touch_presence() (migration 007).
--
-- Permanent delete is owner-only once an entry is trashed: an author's own
-- unconditional hard-delete right is restricted to a not-yet-trashed row,
-- preserving compose.js's failed-upload cleanup path (delete a fresh draft
-- outright) without letting a non-owner destroy a trashed entry. Editing
-- ordinary content (title/body/date/tags) is unaffected by any of this —
-- api.updateLogboekEntry() keeps using a plain `.update()`, since it never
-- touches deleted_at and so never changes the row's SELECT-policy visibility.

-- ── A. ma_posts: audit + soft-delete columns ──────────────────────────────────

alter table ma_posts add column if not exists updated_by uuid references ma_profiles(user_id);
alter table ma_posts add column if not exists deleted_at timestamptz;
alter table ma_posts add column if not exists deleted_by uuid references ma_profiles(user_id);

create index if not exists idx_ma_posts_trash
  on ma_posts (family_id, deleted_at desc) where deleted_at is not null;

-- ── B. RLS: tighten SELECT so only the owner can see trashed rows ────────────

drop policy if exists "ma_posts: members can read" on ma_posts;
create policy "ma_posts: members can read"
  on ma_posts for select
  using (
    ma_is_family_member(family_id)
    and (deleted_at is null or ma_is_family_owner(family_id))
  );

drop policy if exists "ma_posts: care team can read care_team entries" on ma_posts;
create policy "ma_posts: care team can read care_team entries"
  on ma_posts for select
  using (
    audience = 'care_team' and deleted_at is null and ma_is_care_team_member(family_id)
  );

-- ── C. RLS: permanent delete — owner-only once an entry is trashed ───────────

drop policy if exists "ma_posts: authors or owners can delete" on ma_posts;
create policy "ma_posts: authors or owners can delete"
  on ma_posts for delete
  using (
    ma_is_family_member(family_id)
    and (
      (author_id = auth.uid() and deleted_at is null)  -- own, not-yet-trashed (compose.js cleanup)
      or ma_is_family_owner(family_id)                 -- owner: any entry, trashed or not
    )
  );

drop policy if exists "ma_posts: care team can delete own care_team entry" on ma_posts;
create policy "ma_posts: care team can delete own care_team entry"
  on ma_posts for delete
  using (
    audience = 'care_team'
    and author_id = auth.uid()
    and deleted_at is null
    and ma_is_care_team_member(family_id)
  );

-- ── D. Activity trigger: trash / restore, distinct from a content edit ───────
-- Extends ma_trg_logboek_activity() (migration 007). A deleted_at transition is
-- checked first and handled as its own action, before the existing "ignore a
-- pure-timestamp no-op update" / "content edit" / "audience changed" logic —
-- softDeleteLogboekEntry()/restoreLogboekEntry() only ever touch
-- deleted_at/deleted_by/updated_at/updated_by in one call, never mixed with a
-- content edit, so the two paths never overlap in a single UPDATE.

create or replace function public.ma_trg_logboek_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tag_count integer;
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is null then
      return NEW;
    end if;
    v_tag_count := coalesce(array_length(NEW.tags, 1), 0);
    perform ma_record_activity_event(
      NEW.family_id, 'user', auth.uid(), 'app', 'logboek_created',
      'logboek_entry', NEW.id, 'info',
      jsonb_build_object('kind', NEW.kind, 'audience', NEW.audience, 'tag_count', v_tag_count),
      null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if auth.uid() is null then
      return NEW;
    end if;

    if NEW.deleted_at is distinct from OLD.deleted_at then
      if NEW.deleted_at is not null then
        perform ma_record_activity_event(
          NEW.family_id, 'user', auth.uid(), 'app', 'logboek_trashed',
          'logboek_entry', NEW.id, 'info',
          jsonb_build_object('kind', NEW.kind, 'audience', NEW.audience),
          null
        );
      else
        perform ma_record_activity_event(
          NEW.family_id, 'user', auth.uid(), 'app', 'logboek_restored',
          'logboek_entry', NEW.id, 'info',
          jsonb_build_object('kind', NEW.kind, 'audience', NEW.audience),
          null
        );
      end if;
      return NEW;
    end if;

    -- Ignore updates that only touch maintenance timestamps.
    if NEW.title is not distinct from OLD.title
       and NEW.body is not distinct from OLD.body
       and NEW.kind is not distinct from OLD.kind
       and NEW.event_date is not distinct from OLD.event_date
       and NEW.audience is not distinct from OLD.audience
       and NEW.tags is not distinct from OLD.tags
       and NEW.linked_event_uid is not distinct from OLD.linked_event_uid
       and NEW.pinned is not distinct from OLD.pinned then
      return NEW;
    end if;

    if NEW.audience is distinct from OLD.audience then
      perform ma_record_activity_event(
        NEW.family_id, 'user', auth.uid(), 'app', 'logboek_audience_changed',
        'logboek_entry', NEW.id, 'info',
        jsonb_build_object('kind', NEW.kind, 'from_audience', OLD.audience, 'to_audience', NEW.audience),
        null
      );
    else
      v_tag_count := coalesce(array_length(NEW.tags, 1), 0);
      perform ma_record_activity_event(
        NEW.family_id, 'user', auth.uid(), 'app', 'logboek_updated',
        'logboek_entry', NEW.id, 'info',
        jsonb_build_object('kind', NEW.kind, 'audience', NEW.audience, 'tag_count', v_tag_count),
        null
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if auth.uid() is null then
      return OLD;
    end if;
    perform ma_record_activity_event(
      OLD.family_id, 'user', auth.uid(), 'app', 'logboek_deleted',
      'logboek_entry', OLD.id, 'info',
      jsonb_build_object('kind', OLD.kind, 'audience', OLD.audience),
      null
    );
    return OLD;
  end if;

  return null;
end;
$$;

revoke execute on function public.ma_trg_logboek_activity() from public, anon, authenticated;

-- ── E. Trash / restore / permanent-delete RPCs ────────────────────────────────
-- SECURITY DEFINER so the mutation itself bypasses RLS (see the file header
-- for why a plain client-side UPDATE can't do this for a non-owner author);
-- each function enforces the exact same author-or-owner rule explicitly
-- before touching the row. All three are no-ops (0 rows affected, not an
-- error) when the row doesn't exist, isn't in the expected deleted_at state,
-- or the caller isn't permitted — callers distinguish "nothing happened"
-- from a real error via the returned boolean.

create or replace function public.ma_trash_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_family_id uuid;
  v_author_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  select family_id, author_id into v_family_id, v_author_id
  from ma_posts where id = p_post_id and deleted_at is null;

  if v_family_id is null then
    return false; -- no such (not-yet-trashed) entry
  end if;

  if not (v_author_id = auth.uid() or ma_is_family_owner(v_family_id)) then
    return false;
  end if;

  update ma_posts set deleted_at = now(), deleted_by = auth.uid()
   where id = p_post_id and deleted_at is null;

  return true;
end;
$$;

revoke all on function public.ma_trash_logboek_entry(uuid) from public, anon;
grant execute on function public.ma_trash_logboek_entry(uuid) to authenticated;

create or replace function public.ma_restore_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_family_id uuid;
  v_author_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  select family_id, author_id into v_family_id, v_author_id
  from ma_posts where id = p_post_id and deleted_at is not null;

  if v_family_id is null then
    return false; -- no such trashed entry
  end if;

  if not (v_author_id = auth.uid() or ma_is_family_owner(v_family_id)) then
    return false;
  end if;

  update ma_posts set deleted_at = null, deleted_by = null
   where id = p_post_id and deleted_at is not null;

  return true;
end;
$$;

revoke all on function public.ma_restore_logboek_entry(uuid) from public, anon;
grant execute on function public.ma_restore_logboek_entry(uuid) to authenticated;

-- Permanent delete: owner-only for an already-trashed entry; an author may
-- still permanently delete their own entry directly if it was never trashed
-- (compose.js's failed-upload cleanup path).
create or replace function public.ma_permanently_delete_logboek_entry(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_family_id uuid;
  v_author_id uuid;
  v_deleted_at timestamptz;
begin
  if auth.uid() is null then
    return false;
  end if;

  select family_id, author_id, deleted_at into v_family_id, v_author_id, v_deleted_at
  from ma_posts where id = p_post_id;

  if v_family_id is null then
    return false; -- no such entry
  end if;

  if not (
    (v_author_id = auth.uid() and v_deleted_at is null)
    or ma_is_family_owner(v_family_id)
  ) then
    return false;
  end if;

  delete from ma_posts where id = p_post_id;

  return true;
end;
$$;

revoke all on function public.ma_permanently_delete_logboek_entry(uuid) from public, anon;
grant execute on function public.ma_permanently_delete_logboek_entry(uuid) to authenticated;

-- ── F. Retention cleanup helper (not required for normal operation) ──────────
-- Mirrors ma_cleanup_device_rows() (migration 005): permanently deletes Logboek
-- entries trashed more than 30 days ago. Safe to run from a scheduled job —
-- not wired to any cron in this repo; see apps/ma/README.md.

create or replace function public.ma_cleanup_trashed_logboek_entries()
returns void language sql security definer set search_path = public as $$
  delete from ma_posts
   where deleted_at is not null
     and deleted_at < now() - interval '30 days';
$$;

revoke all on function public.ma_cleanup_trashed_logboek_entries() from anon, authenticated;
