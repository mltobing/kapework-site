-- 007_ma_admin_dashboard.sql — idempotent; reflects intended live schema
--
-- Administrative reporting foundation for the owner-only Beheer dashboard:
--   ma_integration_runs  — one row per private irma-sync pipeline execution
--   ma_activity_events   — append-only, owner-visible activity timeline
--   ma_user_presence     — compact "last active" signal (not an event stream)
--   ma_admin_roster()    — owner-only family+care-team roster RPC
--
-- Everything here is owner-only SELECT and has NO browser INSERT/UPDATE/DELETE
-- policy. Writes come from three places only:
--   - the service-role irma-sync job (ma_integration_runs, system-sourced
--     ma_activity_events rows — out of scope for this repo/PR);
--   - ma_touch_presence(), a narrowly-scoped SECURITY DEFINER RPC that can only
--     upsert the caller's own presence row;
--   - SECURITY DEFINER trigger functions on existing tables, firing only when
--     auth.uid() is non-null, that log a *safe* metadata summary of a
--     meaningful browser mutation — never the content itself.
--
-- The legacy ma_calendar_sync_runs table is untouched by this migration. It is
-- currently EMPTY on the live project (verified before writing this file) and
-- is not the contract the new UI reads from. It is not dropped, not renamed,
-- and nothing here depends on it — left for a later cleanup PR.

-- ── A. ma_integration_runs ────────────────────────────────────────────────────

create table if not exists ma_integration_runs (
  id                       uuid        primary key default gen_random_uuid(),
  family_id                uuid        not null references ma_families(id) on delete cascade,
  run_key                  text        not null,
  started_at               timestamptz not null,
  finished_at              timestamptz,
  status                   text        not null default 'running',
  calendar_status          text        not null default 'pending',
  briefing_status          text        not null default 'pending',
  notices_status           text        not null default 'pending',

  events_seen              integer     not null default 0,
  events_created           integer     not null default 0,
  events_updated           integer     not null default 0,
  events_unchanged         integer     not null default 0,
  events_cancelled         integer     not null default 0,

  briefings_updated        integer     not null default 0,
  briefings_unchanged      integer     not null default 0,
  briefings_failed         integer     not null default 0,

  mail_messages_seen       integer     not null default 0,
  mail_extract_calls       integer     not null default 0,
  notice_rows_written      integer     not null default 0,
  notices_superseded       integer     not null default 0,
  notices_auto_resolved    integer     not null default 0,
  mail_parse_failures      integer     not null default 0,
  mail_dropped_non_ride    integer     not null default 0,
  mail_dropped_no_excerpt  integer     not null default 0,

  error_stage              text,
  created_at               timestamptz not null default now(),

  constraint ma_integration_runs_family_run_key_key unique (family_id, run_key),
  constraint ma_integration_runs_status_check
    check (status in ('running', 'success', 'partial', 'failed')),
  constraint ma_integration_runs_calendar_status_check
    check (calendar_status in ('pending', 'success', 'failed', 'skipped')),
  constraint ma_integration_runs_briefing_status_check
    check (briefing_status in ('pending', 'success', 'failed', 'skipped')),
  constraint ma_integration_runs_notices_status_check
    check (notices_status in ('pending', 'success', 'failed', 'disabled', 'misconfigured', 'skipped')),
  constraint ma_integration_runs_run_key_len check (char_length(run_key) between 1 and 120),
  constraint ma_integration_runs_error_stage_len
    check (error_stage is null or char_length(error_stage) between 1 and 80),
  constraint ma_integration_runs_counts_nonneg check (
    events_seen >= 0 and events_created >= 0 and events_updated >= 0
    and events_unchanged >= 0 and events_cancelled >= 0
    and briefings_updated >= 0 and briefings_unchanged >= 0 and briefings_failed >= 0
    and mail_messages_seen >= 0 and mail_extract_calls >= 0 and notice_rows_written >= 0
    and notices_superseded >= 0 and notices_auto_resolved >= 0 and mail_parse_failures >= 0
    and mail_dropped_non_ride >= 0 and mail_dropped_no_excerpt >= 0
  )
);

create index if not exists idx_ma_integration_runs_family_started
  on ma_integration_runs (family_id, started_at desc);
create index if not exists idx_ma_integration_runs_family_status
  on ma_integration_runs (family_id, status, started_at desc);

alter table ma_integration_runs enable row level security;
revoke insert, update, delete on ma_integration_runs from anon, authenticated;

create policy "ma_integration_runs: owner can read"
  on ma_integration_runs for select
  using (ma_is_family_owner(family_id));

-- ── B. ma_activity_events ─────────────────────────────────────────────────────

create table if not exists ma_activity_events (
  id                 uuid        primary key default gen_random_uuid(),
  family_id          uuid        not null references ma_families(id) on delete cascade,
  occurred_at        timestamptz not null default now(),
  actor_type         text        not null,                     -- user | system
  actor_user_id      uuid        references ma_profiles(user_id) on delete set null,
  source             text        not null,                     -- database | app | trusted_device | irma_sync
  action             text        not null,
  object_type        text,
  object_id          uuid,
  severity           text        not null default 'info',      -- info | attention | error
  metadata           jsonb       not null default '{}'::jsonb,
  idempotency_key    text,
  created_at         timestamptz not null default now(),

  constraint ma_activity_events_actor_type_check check (actor_type in ('user', 'system')),
  constraint ma_activity_events_severity_check check (severity in ('info', 'attention', 'error')),
  -- Flexible machine-safe identifiers rather than an ever-growing enum, which
  -- would create cross-repo drift with the private irma-sync job.
  constraint ma_activity_events_source_format check (source ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint ma_activity_events_action_format check (action ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint ma_activity_events_object_type_format
    check (object_type is null or object_type ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint ma_activity_events_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  -- ~2 KB ceiling on the serialized metadata payload — counts/dates/statuses/
  -- labels/opaque ids only, never free text (see the trigger functions below).
  constraint ma_activity_events_metadata_size check (octet_length(metadata::text) <= 2048)
);

create unique index if not exists idx_ma_activity_events_idem
  on ma_activity_events (family_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_ma_activity_events_family_time
  on ma_activity_events (family_id, occurred_at desc);
create index if not exists idx_ma_activity_events_family_actor_time
  on ma_activity_events (family_id, actor_user_id, occurred_at desc);
create index if not exists idx_ma_activity_events_family_source_time
  on ma_activity_events (family_id, source, occurred_at desc);

alter table ma_activity_events enable row level security;
-- No UPDATE/DELETE policy at all: append-only, full stop. No browser INSERT
-- policy either — writes go only through ma_record_activity_event() below,
-- called by the service role (irma-sync) or a SECURITY DEFINER trigger.
revoke insert, update, delete on ma_activity_events from anon, authenticated;

create policy "ma_activity_events: owner can read"
  on ma_activity_events for select
  using (ma_is_family_owner(family_id));

-- Single write path for every activity row, so metadata validation/shape
-- lives in exactly one place. SECURITY DEFINER so the trigger functions below
-- (themselves SECURITY DEFINER, so this nested call runs as their owner) can
-- write despite the table-level revoke above. Deliberately NOT a client RPC:
-- EXECUTE is revoked from every browser role, so it only works as an internal
-- call from another SECURITY DEFINER function — never callable from the app
-- with an arbitrary action/actor/metadata.
create or replace function public.ma_record_activity_event(
  p_family_id       uuid,
  p_actor_type      text,
  p_actor_user_id   uuid,
  p_source          text,
  p_action          text,
  p_object_type     text,
  p_object_id       uuid,
  p_severity        text,
  p_metadata        jsonb,
  p_idempotency_key text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into ma_activity_events (
    family_id, actor_type, actor_user_id, source, action,
    object_type, object_id, severity, metadata, idempotency_key
  ) values (
    p_family_id, p_actor_type, p_actor_user_id, p_source, p_action,
    p_object_type, p_object_id, coalesce(p_severity, 'info'), coalesce(p_metadata, '{}'::jsonb),
    p_idempotency_key
  )
  on conflict (family_id, idempotency_key) where idempotency_key is not null do nothing;
end;
$$;

revoke execute on function public.ma_record_activity_event(
  uuid, text, uuid, text, text, text, uuid, text, jsonb, text
) from public, anon, authenticated;

-- ── C. ma_user_presence ────────────────────────────────────────────────────────

create table if not exists ma_user_presence (
  family_id    uuid        not null references ma_families(id) on delete cascade,
  user_id      uuid        not null references ma_profiles(user_id) on delete cascade,
  last_seen_at timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (family_id, user_id)
);

alter table ma_user_presence enable row level security;
revoke insert, update, delete on ma_user_presence from anon, authenticated;

create policy "ma_user_presence: owner can read"
  on ma_user_presence for select
  using (ma_is_family_owner(family_id));

-- Only narrow, authenticated entry point for presence writes. Uses auth.uid()
-- exclusively (never accepts a user id), allows only an active family member
-- or active care-team member of the target family, and upserts solely the
-- caller's own row. The WHERE clause on the ON CONFLICT branch is the
-- database-layer throttle: a call within ~10 minutes of the last write is a
-- silent no-op, so presence can be touched liberally client-side without
-- churning the row (or generating an activity event — presence is a signal,
-- not an event stream).
create or replace function public.ma_touch_presence(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not (ma_is_family_member(p_family_id) or ma_is_care_team_member(p_family_id)) then
    return;
  end if;

  insert into ma_user_presence (family_id, user_id, last_seen_at, updated_at)
  values (p_family_id, auth.uid(), now(), now())
  on conflict (family_id, user_id) do update
    set last_seen_at = excluded.last_seen_at,
        updated_at   = now()
    where ma_user_presence.last_seen_at < now() - interval '10 minutes';
end;
$$;

revoke all on function public.ma_touch_presence(uuid) from public, anon;
grant execute on function public.ma_touch_presence(uuid) to authenticated;

-- ── D. ma_admin_roster() ────────────────────────────────────────────────────────

create or replace function public.ma_admin_roster(p_family_id uuid)
returns table (
  user_id                    uuid,
  display_name               text,
  relationship               text,
  access_type                text,
  access_status              text,
  access_created_at          timestamptz,
  revoked_at                 timestamptz,
  last_seen_at               timestamptz,
  last_meaningful_action_at  timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- No result for a non-owner — checked before anything else is touched.
  if not ma_is_family_owner(p_family_id) then
    return;
  end if;

  return query
  with roster as (
    select fm.user_id, fm.role as access_type, 'active'::text as access_status,
           fm.created_at as access_created_at, null::timestamptz as revoked_at
    from ma_family_members fm
    where fm.family_id = p_family_id
    union all
    -- Revoked caregivers remain visible to owners.
    select ctm.user_id, 'caregiver'::text as access_type,
           case when ctm.revoked_at is null then 'active' else 'revoked' end as access_status,
           ctm.created_at as access_created_at, ctm.revoked_at
    from ma_care_team_members ctm
    where ctm.family_id = p_family_id
  )
  select
    r.user_id,
    p.display_name,
    p.relationship,
    r.access_type,
    r.access_status,
    r.access_created_at,
    r.revoked_at,
    up.last_seen_at,
    (
      select max(ae.occurred_at) from ma_activity_events ae
      where ae.family_id = p_family_id and ae.actor_user_id = r.user_id
    ) as last_meaningful_action_at
  from roster r
  left join ma_profiles p on p.user_id = r.user_id
  left join ma_user_presence up on up.family_id = p_family_id and up.user_id = r.user_id
  order by r.access_type, p.display_name;
end;
$$;

revoke all on function public.ma_admin_roster(uuid) from public, anon;
grant execute on function public.ma_admin_roster(uuid) to authenticated;

-- ── E. Care-team access audit support ─────────────────────────────────────────

alter table ma_care_team_members add column if not exists revoked_by uuid references auth.users(id);
alter table ma_care_team_members add column if not exists updated_at timestamptz not null default now();

drop trigger if exists ma_care_team_members_set_updated_at_trg on ma_care_team_members;
create trigger ma_care_team_members_set_updated_at_trg
  before update on ma_care_team_members
  for each row execute function set_updated_at();

-- ── F. Meaningful-action triggers ──────────────────────────────────────────────
-- Fire only for authenticated browser mutations (auth.uid() is not null) so
-- the private irma-sync job's own explicit reporting is never duplicated.
-- Safe metadata only — never title/body/comment text, tags, filenames/paths,
-- calendar details, briefing text, mail content, driver names, clock times,
-- device labels, URLs, or emails.

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
    -- Ignore updates that only touch maintenance timestamps (updated_at).
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

drop trigger if exists ma_posts_activity_trg on ma_posts;
create trigger ma_posts_activity_trg
  after insert or update or delete on ma_posts
  for each row execute function ma_trg_logboek_activity();

create or replace function public.ma_trg_comment_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  perform ma_record_activity_event(
    NEW.family_id, 'user', auth.uid(), 'app', 'comment_added',
    'comment', NEW.id, 'info', '{}'::jsonb, null
  );
  return NEW;
end;
$$;

revoke execute on function public.ma_trg_comment_activity() from public, anon, authenticated;

drop trigger if exists ma_comments_activity_trg on ma_comments;
create trigger ma_comments_activity_trg
  after insert on ma_comments
  for each row execute function ma_trg_comment_activity();

create or replace function public.ma_trg_attachment_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_media_type text;
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is null then
      return NEW;
    end if;
    v_media_type := case when NEW.mime_type like 'image/%' then 'image' else 'document' end;
    perform ma_record_activity_event(
      NEW.family_id, 'user', auth.uid(), 'app', 'attachment_added',
      'attachment', NEW.id, 'info', jsonb_build_object('media_type', v_media_type), null
    );
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if auth.uid() is null then
      return OLD;
    end if;
    v_media_type := case when OLD.mime_type like 'image/%' then 'image' else 'document' end;
    perform ma_record_activity_event(
      OLD.family_id, 'user', auth.uid(), 'app', 'attachment_removed',
      'attachment', OLD.id, 'info', jsonb_build_object('media_type', v_media_type), null
    );
    return OLD;
  end if;

  return null;
end;
$$;

revoke execute on function public.ma_trg_attachment_activity() from public, anon, authenticated;

drop trigger if exists ma_attachments_activity_trg on ma_attachments;
create trigger ma_attachments_activity_trg
  after insert or delete on ma_attachments
  for each row execute function ma_trg_attachment_activity();

create or replace function public.ma_trg_briefing_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if OLD.status is distinct from NEW.status then
    if NEW.status = 'sent' then
      perform ma_record_activity_event(
        NEW.family_id, 'user', auth.uid(), 'app', 'briefing_marked_sent',
        'briefing', NEW.id, 'info',
        jsonb_build_object('briefing_date', NEW.briefing_date, 'from_status', OLD.status, 'to_status', NEW.status),
        null
      );
    elsif OLD.status = 'sent' and NEW.status = 'ready' then
      perform ma_record_activity_event(
        NEW.family_id, 'user', auth.uid(), 'app', 'briefing_reopened',
        'briefing', NEW.id, 'info',
        jsonb_build_object('briefing_date', NEW.briefing_date, 'from_status', OLD.status, 'to_status', NEW.status),
        null
      );
    end if;
  end if;
  return NEW;
end;
$$;

revoke execute on function public.ma_trg_briefing_activity() from public, anon, authenticated;

drop trigger if exists ma_briefings_activity_trg on ma_briefings;
create trigger ma_briefings_activity_trg
  after update on ma_briefings
  for each row execute function ma_trg_briefing_activity();

create or replace function public.ma_trg_ride_notice_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return NEW;
  end if;
  if OLD.state is distinct from NEW.state and NEW.state = 'dismissed' then
    perform ma_record_activity_event(
      NEW.family_id, 'user', auth.uid(), 'app', 'ride_notice_dismissed',
      'ride_notice', NEW.id, 'info',
      jsonb_build_object('kind', NEW.kind, 'ride_date', NEW.ride_date),
      null
    );
  end if;
  return NEW;
end;
$$;

revoke execute on function public.ma_trg_ride_notice_activity() from public, anon, authenticated;

drop trigger if exists ma_ride_notices_activity_trg on ma_ride_notices;
create trigger ma_ride_notices_activity_trg
  after update on ma_ride_notices
  for each row execute function ma_trg_ride_notice_activity();

-- Care-team grant/revoke: NOT gated on auth.uid(), because provisioning is
-- always a manual admin action (there is still no browser insert/update
-- policy on ma_care_team_members — see migration 006 and the README). The
-- actor comes from the explicit created_by/revoked_by columns, not the
-- session, since there usually is no authenticated session for this action.
create or replace function public.ma_trg_care_team_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'INSERT' then
    perform ma_record_activity_event(
      NEW.family_id, 'user', NEW.created_by, 'app', 'caregiver_access_granted',
      'care_team_member', NEW.id, 'info', '{}'::jsonb, null
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.revoked_at is null and NEW.revoked_at is not null then
      perform ma_record_activity_event(
        NEW.family_id,
        case when NEW.revoked_by is not null then 'user' else 'system' end,
        NEW.revoked_by, 'app', 'caregiver_access_revoked',
        'care_team_member', NEW.id, 'info', '{}'::jsonb, null
      );
    end if;
    return NEW;
  end if;

  return null;
end;
$$;

revoke execute on function public.ma_trg_care_team_activity() from public, anon, authenticated;

drop trigger if exists ma_care_team_members_activity_trg on ma_care_team_members;
create trigger ma_care_team_members_activity_trg
  after insert or update on ma_care_team_members
  for each row execute function ma_trg_care_team_activity();
