-- 011_ma_document_inbox.sql — idempotent; reflects intended live schema
--
-- Owner-only Document Inbox: paste notes / upload one PDF / upload up to six
-- photos-or-scans → an immutable private source snapshot → server-side Claude
-- extraction → draft candidate Logboek entries → owner review/edit/reject →
-- explicit approval → ordinary `ma_posts` rows with provenance.
--
-- Non-negotiable safety properties enforced by this schema (see apps/ma/README.md
-- "Document Inbox" for the full write-up):
--   - No AI output becomes a ma_posts row without an explicit owner approval call
--     (ma_approve_document_candidates below) — there is no other write path from
--     a candidate to ma_posts.
--   - The AI never chooses visibility: a candidate inherits the import's
--     owner-selected audience; only the owner can change a candidate's audience,
--     and only before approval (ma_save_document_candidate below).
--   - The approving owner is always ma_posts.author_id — Claude is never stored
--     or displayed as an author.
--   - Original import sources (ma_document_imports, ma_document_import_files,
--     ma_document_candidates, and the ma-imports Storage bucket) are owner-only,
--     full stop — no care-team policy, no member policy anywhere in this file.
--     Only the short provenance row (ma_post_sources) is readable by anyone who
--     can already read the resulting post.
--
-- This migration is additive only: four new tables, one new private Storage
-- bucket, and two SECURITY DEFINER RPCs. Nothing here alters ma_posts,
-- ma_attachments, or the existing ma-media bucket.

-- ── Helper: validate every element of a text[] against a max length ──────────
-- Used by CHECK constraints below. Plain SQL/immutable — Postgres CHECK
-- constraints cannot contain a bare subquery, so per-element validation is
-- expressed as a function call instead of an inline `exists (select ... )`.

create or replace function public.ma_text_array_valid(arr text[], max_len integer)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(char_length(trim(t)) > 0 and char_length(t) <= max_len), true)
  from unnest(arr) as t;
$$;

-- ── A. ma_document_imports ────────────────────────────────────────────────────

create table if not exists ma_document_imports (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references ma_families(id) on delete cascade,
  created_by            uuid not null references ma_profiles(user_id),
  audience              text not null default 'family',
  source_type           text not null,
  source_label          text not null,
  document_date         date,
  status                text not null default 'draft',
  source_hash           text,
  duplicate_of          uuid references ma_document_imports(id) on delete set null,
  document_summary      text,
  document_warnings     text[] not null default '{}',
  model                 text,
  prompt_version        text,
  input_tokens          integer,
  output_tokens         integer,
  candidate_count       integer not null default 0,
  error_code            text,
  processing_started_at timestamptz,
  processed_at          timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint ma_document_imports_audience_check     check (audience in ('family', 'care_team')),
  constraint ma_document_imports_source_type_check   check (source_type in ('pasted_text', 'pdf', 'images')),
  constraint ma_document_imports_status_check check (status in (
    'draft', 'uploaded', 'queued', 'processing', 'ready', 'completed', 'failed', 'duplicate', 'cancelled'
  )),
  constraint ma_document_imports_source_label_len     check (char_length(trim(source_label)) between 1 and 200),
  constraint ma_document_imports_input_tokens_nonneg  check (input_tokens is null or input_tokens >= 0),
  constraint ma_document_imports_output_tokens_nonneg check (output_tokens is null or output_tokens >= 0),
  constraint ma_document_imports_candidate_count_nonneg check (candidate_count >= 0),
  constraint ma_document_imports_source_hash_format check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  constraint ma_document_imports_error_code_len check (error_code is null or char_length(error_code) <= 80),
  constraint ma_document_imports_warnings_count check (coalesce(array_length(document_warnings, 1), 0) <= 8),
  constraint ma_document_imports_warnings_valid check (ma_text_array_valid(document_warnings, 300))
);

create index if not exists idx_ma_document_imports_family_created on ma_document_imports (family_id, created_at desc);
create index if not exists idx_ma_document_imports_family_status  on ma_document_imports (family_id, status, created_at desc);
create index if not exists idx_ma_document_imports_family_hash    on ma_document_imports (family_id, source_hash)
  where source_hash is not null;

drop trigger if exists ma_document_imports_set_updated_at_trg on ma_document_imports;
create trigger ma_document_imports_set_updated_at_trg
  before update on ma_document_imports
  for each row execute function set_updated_at();

-- ── B. ma_document_import_files ───────────────────────────────────────────────

create table if not exists ma_document_import_files (
  id                uuid primary key default gen_random_uuid(),
  import_id         uuid not null references ma_document_imports(id) on delete cascade,
  family_id         uuid not null references ma_families(id) on delete cascade,
  uploaded_by       uuid not null references ma_profiles(user_id),
  sequence_no       smallint not null,
  object_path       text not null unique,
  mime_type         text not null,
  size_bytes        bigint not null,
  original_filename text,
  created_at        timestamptz not null default now(),

  constraint ma_document_import_files_sequence_range check (sequence_no between 1 and 6),
  constraint ma_document_import_files_size_positive   check (size_bytes > 0),
  constraint ma_document_import_files_filename_len    check (original_filename is null or char_length(original_filename) <= 255),
  constraint ma_document_import_files_mime_type_check check (mime_type in (
    'text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  )),
  unique (import_id, sequence_no)
);

create index if not exists idx_ma_document_import_files_import  on ma_document_import_files (import_id);
create index if not exists idx_ma_document_import_files_family  on ma_document_import_files (family_id);

-- ── C. ma_document_candidates ─────────────────────────────────────────────────

create table if not exists ma_document_candidates (
  id              uuid primary key default gen_random_uuid(),
  import_id       uuid not null references ma_document_imports(id) on delete cascade,
  family_id       uuid not null references ma_families(id) on delete cascade,
  sequence_no     integer not null,
  status          text not null default 'pending',
  event_date      date,
  date_basis      text not null,
  date_confidence text not null,
  kind            text not null,
  title           text,
  body            text not null,
  audience        text not null,
  tags            text[] not null default '{}',
  source_locator  text,
  source_excerpt  text,
  warnings        text[] not null default '{}',
  follow_up       text,
  post_id         uuid references ma_posts(id) on delete set null,
  updated_by      uuid references ma_profiles(user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ma_document_candidates_status_check          check (status in ('pending', 'rejected', 'approved')),
  constraint ma_document_candidates_date_basis_check       check (date_basis in ('explicit', 'relative_resolved', 'unclear')),
  constraint ma_document_candidates_date_confidence_check  check (date_confidence in ('high', 'medium', 'low')),
  constraint ma_document_candidates_kind_check             check (kind in ('note', 'document', 'observation', 'event_report')),
  constraint ma_document_candidates_audience_check         check (audience in ('family', 'care_team')),
  -- Ambiguous dates stay ambiguous: a candidate whose date could not be safely
  -- established must carry a null event_date, never a guessed one.
  constraint ma_document_candidates_date_unclear_check     check (date_basis <> 'unclear' or event_date is null),
  constraint ma_document_candidates_title_len    check (title is null or char_length(title) <= 120),
  constraint ma_document_candidates_body_len     check (char_length(trim(body)) > 0 and char_length(body) <= 4000),
  constraint ma_document_candidates_locator_len  check (source_locator is null or char_length(source_locator) <= 200),
  constraint ma_document_candidates_excerpt_len  check (source_excerpt is null or char_length(source_excerpt) <= 600),
  constraint ma_document_candidates_follow_up_len check (follow_up is null or char_length(follow_up) <= 1000),
  constraint ma_document_candidates_tags_count      check (coalesce(array_length(tags, 1), 0) <= 12),
  constraint ma_document_candidates_tags_valid      check (ma_text_array_valid(tags, 40)),
  constraint ma_document_candidates_warnings_count  check (coalesce(array_length(warnings, 1), 0) <= 8),
  constraint ma_document_candidates_warnings_valid  check (ma_text_array_valid(warnings, 300)),
  -- A candidate is 'approved' if and only if it carries the post it produced —
  -- this can only ever be set together by ma_approve_document_candidates below.
  constraint ma_document_candidates_approved_has_post check ((status = 'approved') = (post_id is not null)),
  unique (import_id, sequence_no)
);

create index if not exists idx_ma_document_candidates_import         on ma_document_candidates (import_id, sequence_no);
create index if not exists idx_ma_document_candidates_family_status  on ma_document_candidates (family_id, status);
create index if not exists idx_ma_document_candidates_post           on ma_document_candidates (post_id)
  where post_id is not null;

drop trigger if exists ma_document_candidates_set_updated_at_trg on ma_document_candidates;
create trigger ma_document_candidates_set_updated_at_trg
  before update on ma_document_candidates
  for each row execute function set_updated_at();

-- ── D. ma_post_sources — provenance only, never the source or the AI response ──

create table if not exists ma_post_sources (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references ma_families(id) on delete cascade,
  post_id        uuid not null unique references ma_posts(id) on delete cascade,
  import_id      uuid not null references ma_document_imports(id) on delete restrict,
  candidate_id   uuid not null unique references ma_document_candidates(id) on delete restrict,
  source_label   text not null,
  source_locator text,
  approved_by    uuid not null references ma_profiles(user_id),
  approved_at    timestamptz not null default now(),

  constraint ma_post_sources_label_len   check (char_length(trim(source_label)) between 1 and 200),
  constraint ma_post_sources_locator_len check (source_locator is null or char_length(source_locator) <= 200)
);

create index if not exists idx_ma_post_sources_family on ma_post_sources (family_id);
create index if not exists idx_ma_post_sources_import  on ma_post_sources (import_id);

-- ── E. Private Storage bucket: ma-imports ─────────────────────────────────────
-- Separate from ma-media on purpose — different path shape, different RLS,
-- different retention story. Path: <family_id>/<import_id>/<random_uuid>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ma-imports', 'ma-imports', false, 15728640,
  array['text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public              = excluded.public,
  file_size_limit     = excluded.file_size_limit,
  allowed_mime_types  = excluded.allowed_mime_types;

-- ── F. RLS ─────────────────────────────────────────────────────────────────────

alter table ma_document_imports      enable row level security;
alter table ma_document_import_files enable row level security;
alter table ma_document_candidates   enable row level security;
alter table ma_post_sources          enable row level security;

-- Imports: owner-only. No care-team policy, no member policy, no browser DELETE.
create policy "ma_document_imports: owner can read"
  on ma_document_imports for select
  using (ma_is_family_owner(family_id));

create policy "ma_document_imports: owner can insert"
  on ma_document_imports for insert
  with check (ma_is_family_owner(family_id) and created_by = auth.uid());

create policy "ma_document_imports: owner can update"
  on ma_document_imports for update
  using (ma_is_family_owner(family_id))
  with check (ma_is_family_owner(family_id));

revoke delete on ma_document_imports from anon, authenticated;

-- Import files: owner-only; insert only while the parent import is still
-- 'draft'; delete only while it's still recoverable (draft/uploaded/failed);
-- no direct UPDATE at all.
create policy "ma_document_import_files: owner can read"
  on ma_document_import_files for select
  using (ma_is_family_owner(family_id));

create policy "ma_document_import_files: owner can insert while draft"
  on ma_document_import_files for insert
  with check (
    ma_is_family_owner(family_id)
    and uploaded_by = auth.uid()
    and exists (
      select 1 from ma_document_imports i
      where i.id = ma_document_import_files.import_id
        and i.family_id = ma_document_import_files.family_id
        and i.status = 'draft'
    )
  );

create policy "ma_document_import_files: owner can delete while recoverable"
  on ma_document_import_files for delete
  using (
    ma_is_family_owner(family_id)
    and exists (
      select 1 from ma_document_imports i
      where i.id = ma_document_import_files.import_id
        and i.family_id = ma_document_import_files.family_id
        and i.status in ('draft', 'uploaded', 'failed')
    )
  );

revoke update on ma_document_import_files from anon, authenticated;

-- Candidates: owner-only SELECT. No browser INSERT/UPDATE/DELETE at all — every
-- edit/reject/restore/approve goes through the two SECURITY DEFINER RPCs below.
create policy "ma_document_candidates: owner can read"
  on ma_document_candidates for select
  using (ma_is_family_owner(family_id));

revoke insert, update, delete on ma_document_candidates from anon, authenticated;

-- Post sources: readable by whoever can already read the resulting post —
-- family (owner/member) for a 'family' post, plus active care-team for a
-- 'care_team' post. Never broader than the post itself, by construction. No
-- browser INSERT/UPDATE/DELETE — written only by the approval RPC below.
create policy "ma_post_sources: family can read for their own family"
  on ma_post_sources for select
  using (
    exists (
      select 1 from ma_posts p
      where p.id = ma_post_sources.post_id
        and p.family_id = ma_post_sources.family_id
        and ma_is_family_member(p.family_id)
    )
  );

create policy "ma_post_sources: care team can read on care_team posts"
  on ma_post_sources for select
  using (
    exists (
      select 1 from ma_posts p
      where p.id = ma_post_sources.post_id
        and p.family_id = ma_post_sources.family_id
        and p.audience = 'care_team'
        and ma_is_care_team_member(p.family_id)
    )
  );

revoke insert, update, delete on ma_post_sources from anon, authenticated;

-- Storage: ma-imports — owner-only, resolved through the parent import row
-- (never a bare family-id path prefix), upload gated on the import still
-- being 'draft', delete gated on it still being recoverable.
create policy "ma-imports: owner can read own family import objects"
  on storage.objects for select
  using (
    bucket_id = 'ma-imports'
    and exists (
      select 1 from ma_document_imports i
      where i.id = ((string_to_array(name, '/'))[2])::uuid
        and i.family_id = ((string_to_array(name, '/'))[1])::uuid
        and ma_is_family_owner(i.family_id)
    )
  );

create policy "ma-imports: owner can upload while draft"
  on storage.objects for insert
  with check (
    bucket_id = 'ma-imports'
    and exists (
      select 1 from ma_document_imports i
      where i.id = ((string_to_array(name, '/'))[2])::uuid
        and i.family_id = ((string_to_array(name, '/'))[1])::uuid
        and i.status = 'draft'
        and ma_is_family_owner(i.family_id)
    )
  );

create policy "ma-imports: owner can delete while recoverable"
  on storage.objects for delete
  using (
    bucket_id = 'ma-imports'
    and exists (
      select 1 from ma_document_imports i
      where i.id = ((string_to_array(name, '/'))[2])::uuid
        and i.family_id = ((string_to_array(name, '/'))[1])::uuid
        and i.status in ('draft', 'uploaded', 'failed')
        and ma_is_family_owner(i.family_id)
    )
  );

-- ── G. ma_save_document_candidate() — controlled candidate edit RPC ──────────
-- Owner-only edit of a still-pending-or-rejected candidate: date/type/title/
-- body/audience/tags, and a status move between 'pending' and 'rejected' only
-- (never to 'approved' — that only ever happens inside the approval RPC below).
-- Recomputes the parent import's status: still 'ready' while any pending
-- candidate remains, else 'completed'.

create or replace function public.ma_save_document_candidate(
  p_candidate_id    uuid,
  p_event_date      date,
  p_date_basis      text,
  p_date_confidence text,
  p_kind            text,
  p_title           text,
  p_body            text,
  p_audience        text,
  p_tags            text[],
  p_status          text
)
returns ma_document_candidates
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_family_id       uuid;
  v_import_id       uuid;
  v_current_status  text;
  v_import_status   text;
  v_tag             text;
  v_row             ma_document_candidates;
  v_pending_count   integer;
begin
  if auth.uid() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.family_id, c.import_id, c.status
    into v_family_id, v_import_id, v_current_status
    from ma_document_candidates c
    where c.id = p_candidate_id
    for update;

  if v_family_id is null then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if not ma_is_family_owner(v_family_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_current_status not in ('pending', 'rejected') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  if p_status not in ('pending', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_date_basis not in ('explicit', 'relative_resolved', 'unclear') then
    raise exception 'invalid_date_basis' using errcode = '22023';
  end if;
  if p_date_basis = 'unclear' and p_event_date is not null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if p_date_confidence not in ('high', 'medium', 'low') then
    raise exception 'invalid_date_confidence' using errcode = '22023';
  end if;
  if p_kind not in ('note', 'document', 'observation', 'event_report') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_audience not in ('family', 'care_team') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if p_title is not null and char_length(p_title) > 120 then
    raise exception 'title_too_long' using errcode = '22023';
  end if;
  if p_body is null or char_length(trim(p_body)) = 0 or char_length(p_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_tags is not null and array_length(p_tags, 1) > 12 then
    raise exception 'too_many_tags' using errcode = '22023';
  end if;
  if p_tags is not null then
    foreach v_tag in array p_tags loop
      if char_length(trim(v_tag)) = 0 or char_length(v_tag) > 40 then
        raise exception 'invalid_tag' using errcode = '22023';
      end if;
    end loop;
  end if;

  update ma_document_candidates
     set event_date      = p_event_date,
         date_basis      = p_date_basis,
         date_confidence = p_date_confidence,
         kind            = p_kind,
         title           = nullif(p_title, ''),
         body            = p_body,
         audience        = p_audience,
         tags            = coalesce(p_tags, '{}'),
         status          = p_status,
         updated_by      = auth.uid(),
         updated_at      = now()
   where id = p_candidate_id
   returning * into v_row;

  select status into v_import_status from ma_document_imports where id = v_import_id for update;

  if v_import_status in ('ready', 'completed') then
    select count(*) into v_pending_count
      from ma_document_candidates
      where import_id = v_import_id and status = 'pending';

    if v_pending_count > 0 then
      update ma_document_imports set status = 'ready' where id = v_import_id and status <> 'ready';
    else
      update ma_document_imports set status = 'completed', completed_at = now()
        where id = v_import_id and status <> 'completed';
    end if;
  end if;

  return v_row;
end;
$$;

revoke all on function public.ma_save_document_candidate(uuid, date, text, text, text, text, text, text, text[], text)
  from public, anon;
grant execute on function public.ma_save_document_candidate(uuid, date, text, text, text, text, text, text, text[], text)
  to authenticated;

-- ── H. ma_approve_document_candidates() — transactional approval RPC ─────────
-- Owner-only. Every selected candidate must belong to the import and be
-- 'pending' (or already 'approved' with a post — idempotent double-submit
-- recovery); any 'rejected' candidate in the selection fails the whole call.
-- One transaction: for each newly-approved candidate, insert one ma_posts row
-- (author_id = the approving owner, never Claude), one ma_post_sources row
-- carrying only source_label/source_locator, and mark the candidate approved.
-- A repeated call with the same ids is a no-op that returns the same mapping —
-- never a second post.

create or replace function public.ma_approve_document_candidates(
  p_import_id     uuid,
  p_candidate_ids uuid[]
)
returns table(candidate_id uuid, post_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_family_id       uuid;
  v_source_label    text;
  v_candidate       record;
  v_new_post_id     uuid;
  v_pending_remaining integer;
  v_ids             uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_candidate_ids is null or array_length(p_candidate_ids, 1) is null then
    raise exception 'no_candidates' using errcode = '22023';
  end if;

  -- De-duplicate defensively so a repeated id in the input array can never
  -- produce two posts for the same candidate in one call.
  v_ids := array(select distinct unnest(p_candidate_ids));

  select family_id, source_label into v_family_id, v_source_label
    from ma_document_imports
    where id = p_import_id
    for update;

  if v_family_id is null then
    raise exception 'import_not_found' using errcode = 'P0002';
  end if;

  if not ma_is_family_owner(v_family_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Lock every selected candidate row up front, in a deterministic order.
  perform 1 from ma_document_candidates where id = any(v_ids) order by id for update;

  if (select count(*) from ma_document_candidates where id = any(v_ids)) <> array_length(v_ids, 1) then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from ma_document_candidates where id = any(v_ids) and import_id <> p_import_id) then
    raise exception 'candidate_mismatch' using errcode = '22023';
  end if;

  if exists (select 1 from ma_document_candidates where id = any(v_ids) and status = 'rejected') then
    raise exception 'candidate_rejected' using errcode = '22023';
  end if;

  for v_candidate in
    select * from ma_document_candidates where id = any(v_ids) order by sequence_no
  loop
    if v_candidate.status = 'approved' then
      -- Idempotent double-submit recovery — report the existing mapping back
      -- rather than erroring or creating a second post.
      candidate_id := v_candidate.id;
      post_id       := v_candidate.post_id;
      return next;
      continue;
    end if;

    insert into ma_posts (
      family_id, author_id, kind, title, body, event_date, audience, tags,
      linked_event_uid, pinned, updated_by
    ) values (
      v_family_id, auth.uid(), v_candidate.kind, v_candidate.title, v_candidate.body,
      v_candidate.event_date, v_candidate.audience, v_candidate.tags,
      null, false, auth.uid()
    )
    returning id into v_new_post_id;

    insert into ma_post_sources (
      family_id, post_id, import_id, candidate_id, source_label, source_locator, approved_by
    ) values (
      v_family_id, v_new_post_id, p_import_id, v_candidate.id, v_source_label,
      v_candidate.source_locator, auth.uid()
    );

    update ma_document_candidates
       set status = 'approved', post_id = v_new_post_id, updated_by = auth.uid(), updated_at = now()
     where id = v_candidate.id;

    candidate_id := v_candidate.id;
    post_id       := v_new_post_id;
    return next;
  end loop;

  select count(*) into v_pending_remaining
    from ma_document_candidates
    where import_id = p_import_id and status = 'pending';

  if v_pending_remaining = 0 then
    update ma_document_imports set status = 'completed', completed_at = now() where id = p_import_id;
  else
    update ma_document_imports set status = 'ready' where id = p_import_id;
  end if;

  return;
end;
$$;

revoke all on function public.ma_approve_document_candidates(uuid, uuid[]) from public, anon;
grant execute on function public.ma_approve_document_candidates(uuid, uuid[]) to authenticated;
