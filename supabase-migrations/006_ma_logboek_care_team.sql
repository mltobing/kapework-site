-- 006_ma_logboek_care_team.sql — idempotent; reflects intended live schema
--
-- Turns the existing ma_posts/ma_comments/ma_attachments/ma-media architecture
-- into a chronological "Logboek" with a strict, RLS-enforced audience field:
--   family      — only owner/member family users (safe default)
--   care_team   — family users plus active care-team users
--
-- Care-team membership is a SEPARATE table (ma_care_team_members), never a row
-- in ma_family_members, so existing family policies (built on
-- ma_is_family_member) cannot accidentally broaden to include care-team users.
-- Attachments and comments carry no audience column of their own — they always
-- inherit the parent post's audience via a JOIN back to ma_posts, so they can
-- never be broader than their parent by construction.
--
-- The trusted /vandaag device (ma_trusted_devices / ma_device_pairings,
-- 005_ma_trusted_devices.sql) is untouched by this migration and stays
-- completely separate — it never reads ma_posts/ma_comments/ma_attachments.

-- ── A. ma_posts: audience, tags, linked event, updated_at ────────────────────

alter table ma_posts add column if not exists audience         text        not null default 'family';
alter table ma_posts add column if not exists tags             text[]      not null default '{}';
alter table ma_posts add column if not exists linked_event_uid text;
alter table ma_posts add column if not exists updated_at       timestamptz not null default now();

do $$ begin
  alter table ma_posts add constraint ma_posts_audience_check check (audience in ('family', 'care_team'));
exception when duplicate_object then null;
end $$;

-- Migrate the kind check constraint safely: keep every value already live in
-- production (photo, note, voice, prompt, today) so existing rows stay valid,
-- and add the five Logboek entry types. 'note' and 'photo' were already legal.
alter table ma_posts drop constraint if exists ma_posts_kind_check;
alter table ma_posts add constraint ma_posts_kind_check
  check (kind = any (array[
    'photo', 'note', 'voice', 'prompt', 'today',   -- pre-existing values, preserved
    'document', 'observation', 'event_report'      -- new Logboek entry types
  ]));

-- Keep updated_at current on every edit (reuses the existing set_updated_at()
-- trigger function already used by internal_people / internal_devices).
drop trigger if exists ma_posts_set_updated_at_trg on ma_posts;
create trigger ma_posts_set_updated_at_trg
  before update on ma_posts
  for each row execute function set_updated_at();

-- Attachments must always have a parent post — an attachment with no post has
-- no defined audience to inherit, which would break the "never broader than
-- parent" guarantee. The one existing attachment row already has a post_id.
alter table ma_attachments alter column post_id set not null;

-- Indexes: family timeline, audience, kind, event_date, tags, linked event.
create index if not exists idx_ma_posts_family_timeline on ma_posts (family_id, created_at desc);
create index if not exists idx_ma_posts_audience         on ma_posts (audience);
create index if not exists idx_ma_posts_kind             on ma_posts (kind);
create index if not exists idx_ma_posts_event_date       on ma_posts (event_date);
create index if not exists idx_ma_posts_tags             on ma_posts using gin (tags);
create index if not exists idx_ma_posts_linked_event_uid on ma_posts (linked_event_uid)
  where linked_event_uid is not null;

-- ── B. Care-team membership (separate table on purpose) ──────────────────────

create table if not exists ma_care_team_members (
  id          uuid        primary key default gen_random_uuid(),
  family_id   uuid        not null references ma_families(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_by  uuid        not null references auth.users(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (family_id, user_id)
);

create index if not exists idx_ma_care_team_members_family on ma_care_team_members (family_id);
create index if not exists idx_ma_care_team_members_user   on ma_care_team_members (user_id);
create index if not exists idx_ma_care_team_members_active
  on ma_care_team_members (family_id, user_id) where revoked_at is null;

alter table ma_care_team_members enable row level security;

-- Provisioning/revocation is a manual admin step for this PR (see README) —
-- deliberately no insert/update/delete policy, so writes only happen via the
-- Supabase SQL editor (service role bypasses RLS). Belt-and-suspenders: also
-- revoke the write grants anon/authenticated pick up from public-schema
-- defaults, matching the pattern used for ma_trusted_devices.
revoke insert, update, delete on ma_care_team_members from anon, authenticated;

create policy "ma_care_team_members: self can view own membership"
  on ma_care_team_members for select
  using (user_id = auth.uid());

create policy "ma_care_team_members: family can view roster"
  on ma_care_team_members for select
  using (ma_is_family_member(family_id));

-- SECURITY DEFINER helper, mirroring ma_is_family_member/ma_is_family_owner:
-- fixed search_path, least privilege, active only while revoked_at is null.
create or replace function public.ma_is_care_team_member(target_family_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from ma_care_team_members
    where family_id  = target_family_id
      and user_id    = auth.uid()
      and revoked_at is null
  );
$$;

-- ── C. RLS: ma_posts ──────────────────────────────────────────────────────────
-- Existing family policies (members can read/insert; authors can update;
-- authors-or-owners can delete) are unchanged — they already give family
-- owner/member full read of every audience and full write of their own posts,
-- and already give the owner delete-any (ma_is_family_owner implies
-- ma_is_family_member). What's missing is: care-team access, and owner
-- update-any (today only the author can update, not just the owner).

create policy "ma_posts: care team can read care_team entries"
  on ma_posts for select
  using (audience = 'care_team' and ma_is_care_team_member(family_id));

create policy "ma_posts: care team can insert care_team entries"
  on ma_posts for insert
  with check (
    audience = 'care_team'
    and author_id = auth.uid()
    and ma_is_care_team_member(family_id)
  );

create policy "ma_posts: owners can update any family entry"
  on ma_posts for update
  using (ma_is_family_owner(family_id))
  with check (ma_is_family_owner(family_id));

-- Care team may only ever touch their own care_team entry, and the with_check
-- (audience = 'care_team') blocks moving it to 'family' — the row must still
-- satisfy the same audience/author/membership conditions after the update.
create policy "ma_posts: care team can update own care_team entry"
  on ma_posts for update
  using (
    audience = 'care_team' and author_id = auth.uid() and ma_is_care_team_member(family_id)
  )
  with check (
    audience = 'care_team' and author_id = auth.uid() and ma_is_care_team_member(family_id)
  );

create policy "ma_posts: care team can delete own care_team entry"
  on ma_posts for delete
  using (
    audience = 'care_team' and author_id = auth.uid() and ma_is_care_team_member(family_id)
  );

-- ── C. RLS: ma_comments ───────────────────────────────────────────────────────
-- Access is allowed only when the parent post is readable under the same
-- rules; the insert with_check also pins comment.family_id to match the
-- parent post's family_id so a client can't supply a mismatched family_id.

drop policy if exists "ma_comments: members can insert" on ma_comments;
create policy "ma_comments: members can insert"
  on ma_comments for insert
  with check (
    author_id = auth.uid()
    and ma_is_family_member(family_id)
    and exists (
      select 1 from ma_posts p
      where p.id = ma_comments.post_id and p.family_id = ma_comments.family_id
    )
  );

create policy "ma_comments: care team can read on care_team posts"
  on ma_comments for select
  using (
    exists (
      select 1 from ma_posts p
      where p.id = ma_comments.post_id
        and p.family_id = ma_comments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma_comments: care team can insert on care_team posts"
  on ma_comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from ma_posts p
      where p.id = ma_comments.post_id
        and p.family_id = ma_comments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma_comments: care team can update own comment"
  on ma_comments for update
  using (
    author_id = auth.uid()
    and exists (
      select 1 from ma_posts p
      where p.id = ma_comments.post_id
        and p.family_id = ma_comments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma_comments: care team can delete own comment"
  on ma_comments for delete
  using (
    author_id = auth.uid()
    and exists (
      select 1 from ma_posts p
      where p.id = ma_comments.post_id
        and p.family_id = ma_comments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

-- ── C. RLS: ma_attachments ─────────────────────────────────────────────────────
-- Metadata access follows the parent post, never a bare family_id/post_id.

drop policy if exists "ma_attachments: members can insert" on ma_attachments;
create policy "ma_attachments: members can insert"
  on ma_attachments for insert
  with check (
    uploader_id = auth.uid()
    and ma_is_family_member(family_id)
    and exists (
      select 1 from ma_posts p
      where p.id = ma_attachments.post_id and p.family_id = ma_attachments.family_id
    )
  );

create policy "ma_attachments: care team can read on care_team posts"
  on ma_attachments for select
  using (
    exists (
      select 1 from ma_posts p
      where p.id = ma_attachments.post_id
        and p.family_id = ma_attachments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

-- Care team may only upload to a care_team post they are permitted to edit
-- (i.e. their own — see the posts update/delete policies above).
create policy "ma_attachments: care team can insert on own care_team posts"
  on ma_attachments for insert
  with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from ma_posts p
      where p.id = ma_attachments.post_id
        and p.family_id = ma_attachments.family_id
        and p.audience = 'care_team'
        and p.author_id = auth.uid()
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma_attachments: care team can delete own attachment"
  on ma_attachments for delete
  using (
    uploader_id = auth.uid()
    and exists (
      select 1 from ma_posts p
      where p.id = ma_attachments.post_id
        and p.family_id = ma_attachments.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

-- ── C. RLS: ma_profiles — care-team-linked visibility ─────────────────────────
-- Rendering an entry's author name requires reading the author's ma_profiles
-- row. The pre-existing "view co-members" policy only covers two users who
-- share an ma_family_members row, so it does NOT cover a family member
-- viewing a caregiver's name, or vice versa, or two caregivers viewing each
-- other — that link now runs through ma_care_team_members instead.
--
-- This MUST go through a SECURITY DEFINER helper, not a plain subquery: a
-- care-team user has no RLS grant into ma_family_members at all, and no grant
-- into another caregiver's ma_care_team_members row, so a direct subquery
-- here would be silently blocked by those tables' own RLS before it ever gets
-- to compare rows. The helper exposes only a boolean, not row data, and is
-- scoped strictly to the shared family context — a care-team member still
-- cannot see profiles outside families they serve.

create or replace function public.ma_shares_family_context(target_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select
    exists ( -- viewer and target are both family members of the same family
      select 1
      from ma_family_members viewer_fm
      join ma_family_members target_fm on target_fm.family_id = viewer_fm.family_id
      where viewer_fm.user_id = auth.uid() and target_fm.user_id = target_user_id
    )
    or exists ( -- viewer is family, target is an active caregiver for that family
      select 1
      from ma_family_members viewer_fm
      join ma_care_team_members target_ctm
        on target_ctm.family_id = viewer_fm.family_id and target_ctm.revoked_at is null
      where viewer_fm.user_id = auth.uid() and target_ctm.user_id = target_user_id
    )
    or exists ( -- viewer is an active caregiver, target is family for that family
      select 1
      from ma_care_team_members viewer_ctm
      join ma_family_members target_fm on target_fm.family_id = viewer_ctm.family_id
      where viewer_ctm.user_id = auth.uid() and viewer_ctm.revoked_at is null
        and target_fm.user_id = target_user_id
    )
    or exists ( -- viewer and target are both active caregivers for the same family
      select 1
      from ma_care_team_members viewer_ctm
      join ma_care_team_members target_ctm
        on target_ctm.family_id = viewer_ctm.family_id and target_ctm.revoked_at is null
      where viewer_ctm.user_id = auth.uid() and viewer_ctm.revoked_at is null
        and target_ctm.user_id = target_user_id
    );
$$;

create policy "ma_profiles: view care-team-linked"
  on ma_profiles for select
  using (ma_shares_family_context(user_id));

-- ── C. Storage: ma-media — care-team access follows the parent post ──────────
-- Object paths are "<family_id>/<post_id>/<filename>" (storage.js). Existing
-- family policies are path-based on the family_id segment only, which is
-- already correct for family users (they can read every post in their
-- family regardless of audience). Care-team access must instead resolve the
-- post_id segment back to ma_posts so a guessed path cannot bypass audience.

create policy "ma-media: care team can read on care_team posts"
  on storage.objects for select
  using (
    bucket_id = 'ma-media'
    and exists (
      select 1 from ma_posts p
      where p.id        = ((string_to_array(name, '/'))[2])::uuid
        and p.family_id  = ((string_to_array(name, '/'))[1])::uuid
        and p.audience   = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma-media: care team can upload to own care_team posts"
  on storage.objects for insert
  with check (
    bucket_id = 'ma-media'
    and exists (
      select 1 from ma_posts p
      where p.id        = ((string_to_array(name, '/'))[2])::uuid
        and p.family_id  = ((string_to_array(name, '/'))[1])::uuid
        and p.audience   = 'care_team'
        and p.author_id  = auth.uid()
        and ma_is_care_team_member(p.family_id)
    )
  );

create policy "ma-media: care team can delete own upload"
  on storage.objects for delete
  using (
    bucket_id = 'ma-media'
    and auth.uid() = owner
    and exists (
      select 1 from ma_posts p
      where p.id        = ((string_to_array(name, '/'))[2])::uuid
        and p.family_id  = ((string_to_array(name, '/'))[1])::uuid
        and p.audience   = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );
