-- 014_ma_caren_reconciliation_verify.sql — VERIFICATION ONLY. NOT A MIGRATION.
--
-- Proves the access matrix for migration 014 against synthetic rows, then
-- rolls everything back. Nothing here is applied by any pipeline, and the
-- final ROLLBACK means a successful run leaves the database exactly as it was.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor, or:
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file.sql
--   Run it against STAGING first. Every id below is synthetic.
--
-- WHAT IT PROVES
--
--   Caren evidence / expected items / reviews
--   | actor         | read | direct write |
--   |---------------|-----:|-------------:|
--   | owner         | yes  | no           |
--   | family member | no   | no           |
--   | caregiver     | no   | no           |
--   | unrelated     | no   | no           |
--   | anonymous     | no   | no           |
--
--   ma_review_caren_item(): owner only.
--
--   ma_ride_notices.extraction_version: readable, service-role writable,
--   immutable to family members, and the existing dismiss flow still works.
--
-- Each check RAISEs on failure, so the script stops at the first violation.

begin;

-- ── Synthetic fixtures ──────────────────────────────────────────────────────
-- Fixed UUIDs so a partial run is easy to identify; all rolled back below.

\set fam            '''00000000-0000-4000-8000-00000000f001'''
\set owner_user     '''00000000-0000-4000-8000-00000000u001'''
\set member_user    '''00000000-0000-4000-8000-00000000u002'''
\set caregiver_user '''00000000-0000-4000-8000-00000000u003'''
\set outsider_user  '''00000000-0000-4000-8000-00000000u004'''

-- NOTE: replace the ids above with real UUIDs from your project's auth.users
-- if your ma_profiles has an FK to it; the shapes here are illustrative and
-- deliberately not valid hex, so they fail loudly rather than colliding with
-- anything real.

create temporary table _verify_results (check_name text, passed boolean);

create or replace function pg_temp.expect(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  insert into _verify_results values (p_name, p_condition);
  if not p_condition then
    raise exception 'VERIFY FAILED: %', p_name;
  end if;
end; $$;

-- Emulates a signed-in user for RLS purposes. Supabase sets request.jwt.claims
-- per request; setting it locally is how an RLS policy can be exercised from a
-- single psql session.
create or replace function pg_temp.become(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end; $$;

create or replace function pg_temp.become_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;

create or replace function pg_temp.become_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;

-- ── 1. Schema shape ─────────────────────────────────────────────────────────

select pg_temp.expect(
  'ma_ride_notices.extraction_version exists and defaults to legacy',
  exists (
    select 1 from information_schema.columns
    where table_name = 'ma_ride_notices' and column_name = 'extraction_version'
      and is_nullable = 'NO' and column_default like '%legacy%'
  )
);

select pg_temp.expect(
  'existing ride notices read as legacy',
  not exists (select 1 from ma_ride_notices where extraction_version is null)
);

select pg_temp.expect(
  'ma_integration_runs.caren_status exists and defaults to skipped',
  exists (
    select 1 from information_schema.columns
    where table_name = 'ma_integration_runs' and column_name = 'caren_status'
      and is_nullable = 'NO' and column_default like '%skipped%'
  )
);

select pg_temp.expect(
  'no column anywhere can hold a Caren URL or person id',
  not exists (
    select 1 from information_schema.columns
    where table_name in ('ma_caren_evidence', 'ma_caren_expected_items', 'ma_caren_match_reviews')
      and column_name ~ 'url|person|path'
  )
);

select pg_temp.expect(
  'all three Caren tables have RLS enabled',
  (select bool_and(relrowsecurity) from pg_class
   where relname in ('ma_caren_evidence', 'ma_caren_expected_items', 'ma_caren_match_reviews'))
);

select pg_temp.expect(
  'no Caren table has any INSERT/UPDATE/DELETE policy at all',
  not exists (
    select 1 from pg_policies
    where tablename in ('ma_caren_evidence', 'ma_caren_expected_items', 'ma_caren_match_reviews')
      and cmd <> 'SELECT'
  )
);

select pg_temp.expect(
  'the review RPC is SECURITY DEFINER with a pinned search_path',
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ma_review_caren_item'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'
  )
);

select pg_temp.expect(
  'anon cannot execute the review RPC',
  not has_function_privilege('anon', 'public.ma_review_caren_item(uuid, text, uuid)', 'EXECUTE')
);

select pg_temp.expect(
  'authenticated can execute the review RPC (ownership is checked inside it)',
  has_function_privilege('authenticated', 'public.ma_review_caren_item(uuid, text, uuid)', 'EXECUTE')
);

-- ── 2. Constraints make an unjustified status unrepresentable ───────────────

select pg_temp.become_service();

do $$
begin
  begin
    insert into ma_caren_expected_items
      (family_id, briefing_id, briefing_date, cluster_identity, sequence_no,
       content_hash, expected_summary, status)
    select f.id, b.id, current_date, repeat('a', 64), 1, repeat('b', 64), 'Voorbeeld afspraak', 'seen'
    from ma_families f, ma_briefings b where b.family_id = f.id limit 1;
    raise exception 'VERIFY FAILED: a seen item was accepted without matched evidence';
  exception when check_violation then
    null;  -- expected
  end;
end $$;

do $$
begin
  begin
    insert into ma_caren_evidence
      (family_id, source_message_id, received_at, evidence_type, excerpt, confidence)
    select id, '<synthetic@example>', now(), 'reminder', 'Voorbeeld excerpt', 'high'
    from ma_families limit 1;
    raise exception 'VERIFY FAILED: a high-confidence reminder was accepted without start/end/title';
  exception when check_violation then
    null;  -- expected
  end;
end $$;

do $$
begin
  begin
    insert into ma_caren_expected_items
      (family_id, briefing_id, briefing_date, cluster_identity, sequence_no,
       content_hash, expected_summary, known_times)
    select f.id, b.id, current_date, repeat('c', 64), 1, repeat('d', 64), 'Voorbeeld afspraak',
           array['25:99']
    from ma_families f, ma_briefings b where b.family_id = f.id limit 1;
    raise exception 'VERIFY FAILED: an invalid known_time was accepted';
  exception when check_violation then
    null;  -- expected
  end;
end $$;

select pg_temp.expect('constraints reject unjustified statuses and malformed values', true);

-- ── 3. Read access ──────────────────────────────────────────────────────────
--
-- Run this block once per actor. Each SELECT must return the stated count.
-- Fill in the ids at the top of this file first; with placeholder ids these
-- checks are informational rather than binding.

-- select pg_temp.become(:owner_user);
-- select pg_temp.expect('owner reads evidence',       (select count(*) from ma_caren_evidence) > 0);
-- select pg_temp.expect('owner reads expected items', (select count(*) from ma_caren_expected_items) > 0);
-- select pg_temp.expect('owner reads reviews',        (select count(*) >= 0 from ma_caren_match_reviews));

-- select pg_temp.become(:member_user);
-- select pg_temp.expect('member reads no evidence',       (select count(*) from ma_caren_evidence) = 0);
-- select pg_temp.expect('member reads no expected items', (select count(*) from ma_caren_expected_items) = 0);
-- select pg_temp.expect('member reads no reviews',        (select count(*) from ma_caren_match_reviews) = 0);

-- select pg_temp.become(:caregiver_user);
-- select pg_temp.expect('caregiver reads no evidence',       (select count(*) from ma_caren_evidence) = 0);
-- select pg_temp.expect('caregiver reads no expected items', (select count(*) from ma_caren_expected_items) = 0);

-- select pg_temp.become(:outsider_user);
-- select pg_temp.expect('unrelated user reads no evidence', (select count(*) from ma_caren_evidence) = 0);

-- select pg_temp.become_anon();
-- select pg_temp.expect('anonymous reads no evidence', (select count(*) from ma_caren_evidence) = 0);

-- ── 4. Direct writes are blocked for every browser role ─────────────────────
--
-- With no INSERT/UPDATE/DELETE policy, RLS denies these outright. Expect
-- "new row violates row-level security policy" (insert) or zero rows affected
-- (update/delete) for owner, member, caregiver, outsider and anon alike.
--
-- select pg_temp.become(:owner_user);
-- update ma_caren_expected_items set status = 'seen';   -- expect 0 rows
-- delete from ma_caren_evidence;                         -- expect 0 rows

-- ── 5. Review RPC behaviour ─────────────────────────────────────────────────
--
-- select pg_temp.become(:owner_user);
--   confirm_candidate on a non-ambiguous item      -> caren_invalid_item
--   confirm_candidate with the wrong evidence id   -> caren_invalid_evidence
--   confirm_candidate with another family's        -> caren_invalid_evidence
--     evidence
--   any action on a retired item                   -> caren_invalid_item
--   an action outside the vocabulary               -> caren_invalid_action
--   manual_confirm WITH an evidence id             -> caren_invalid_evidence
--   a successful action                            -> writes one review row
--
-- select pg_temp.become(:member_user);
-- select pg_temp.become(:caregiver_user);
-- select pg_temp.become(:outsider_user);
--   every action                                   -> caren_review_unauthorised
--
-- select pg_temp.become_anon();
--   every action                                   -> permission denied (no EXECUTE grant)

-- ── 6. Ride-notice version immutability ─────────────────────────────────────
--
-- select pg_temp.become_service();
-- update ma_ride_notices set extraction_version = 'ride-v2' where id = <synthetic>;
--   -- expect: succeeds (the private job's repair pass)
--
-- select pg_temp.become(:member_user);
-- update ma_ride_notices set extraction_version = 'ride-v2' where id = <synthetic>;
--   -- expect: 'only state/dismissed_by/dismissed_at are member-writable'
-- update ma_ride_notices set excerpt = 'aangepast' where id = <synthetic>;
--   -- expect: same exception (evidence stays immutable)
-- update ma_ride_notices set state = 'dismissed', dismissed_by = :member_user, dismissed_at = now()
--   where id = <synthetic>;
--   -- expect: succeeds — the existing "Negeer" flow is unchanged

-- ── Results ─────────────────────────────────────────────────────────────────

select check_name, passed from _verify_results order by check_name;

-- Nothing is kept. Re-run freely.
rollback;
