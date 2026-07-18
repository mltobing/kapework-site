-- 005_ma_trusted_devices.sql — idempotent; reflects intended live schema
--
-- Trusted-device pairing for the care recipient's read-only "Vandaag" display.
--
-- A signed-in family member creates a short-lived pairing (link + code). The care
-- recipient's device consumes it once and receives a long-lived, revocable device
-- token. Only the SHA-256 hash of each secret is ever stored here — never the raw
-- token or code. All access is through server-only Netlify Functions using the
-- service-role key; browsers (anon and authenticated) get NO direct access to
-- these rows. RLS is therefore enabled with no permissive policies: default-deny
-- for every non-service role, while the service role bypasses RLS.
--
-- Nothing in this feature can read family data. The device token only unlocks a
-- server-built, sanitized "today" payload — see the ma-today Function.

-- ── Trusted devices ──────────────────────────────────────────────────────────
create table if not exists ma_trusted_devices (
  id            uuid        primary key default gen_random_uuid(),
  family_id     uuid        not null references ma_families(id) on delete cascade,
  label         text        not null,
  scope         text        not null default 'today_readonly'
                            check (scope in ('today_readonly')),
  token_hash    text        not null unique,          -- SHA-256(raw_token + pepper)
  created_by    uuid        not null references auth.users(id),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  constraint ma_trusted_devices_label_len check (char_length(label) between 1 and 80)
);

-- Active-device lookup is by token_hash (already unique-indexed). These support
-- listing per family and expiry-based cleanup.
create index if not exists ma_trusted_devices_family_idx  on ma_trusted_devices (family_id);
create index if not exists ma_trusted_devices_expires_idx on ma_trusted_devices (expires_at);

-- ── One-time pairings ────────────────────────────────────────────────────────
create table if not exists ma_device_pairings (
  id               uuid        primary key default gen_random_uuid(),
  family_id        uuid        not null references ma_families(id) on delete cascade,
  created_by       uuid        not null references auth.users(id),
  requested_label  text,
  link_token_hash  text        not null unique,       -- SHA-256(raw_link_token + pepper)
  code_hash        text        not null,              -- SHA-256(raw_code + pepper)
  attempt_count    integer     not null default 0,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  constraint ma_device_pairings_label_len
    check (requested_label is null or char_length(requested_label) between 1 and 80)
);

-- Activation resolves an unconsumed pairing by link_token_hash (unique) or by
-- code_hash. Partial index keeps the active-code lookup cheap and correct.
create index if not exists ma_device_pairings_active_code_idx
  on ma_device_pairings (code_hash) where consumed_at is null;
create index if not exists ma_device_pairings_family_idx  on ma_device_pairings (family_id);
create index if not exists ma_device_pairings_expires_idx on ma_device_pairings (expires_at);

-- ── RLS: default-deny for every browser role ─────────────────────────────────
-- No policies are created on purpose. With RLS enabled and no permissive policy,
-- anon and authenticated roles can neither read nor write these tables directly;
-- all legitimate access goes through service-role Netlify Functions that verify
-- family membership first. Raw token/code hashes never reach a browser.
alter table ma_trusted_devices enable row level security;
alter table ma_device_pairings enable row level security;

-- Belt-and-suspenders: revoke any table privileges the api roles may have picked
-- up from database-wide default grants, so the deny is enforced at the GRANT layer
-- too (not only by RLS).
revoke all on ma_trusted_devices from anon, authenticated;
revoke all on ma_device_pairings from anon, authenticated;

-- ── Cleanup helper (service-role only; not required for normal operation) ─────
-- Deletes expired/consumed pairings and long-expired revoked devices. Safe to run
-- from a scheduled job; see apps/ma/README.md. Never touches active devices.
create or replace function ma_cleanup_device_rows()
returns void language sql security definer set search_path = public as $$
  delete from ma_device_pairings
   where consumed_at is not null
      or expires_at < now() - interval '1 day';
  delete from ma_trusted_devices
   where revoked_at is not null
     and revoked_at < now() - interval '30 days';
$$;

revoke all on function ma_cleanup_device_rows() from anon, authenticated;
