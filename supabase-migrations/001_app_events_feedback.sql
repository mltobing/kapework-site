-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 — app_events + app_feedback
-- Run in: Supabase project → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. app_events ──────────────────────────────────────────────────────────────
--    Written exclusively by the Netlify function (service role key).
--    No direct browser access — RLS blocks everything at the anon level.

create table if not exists app_events (
  id          bigserial    primary key,
  event_name  text         not null,
  app_slug    text         not null,
  device_id   text,
  session_id  text,
  url         text,
  props       jsonb,
  created_at  timestamptz  not null default now()
);

alter table app_events enable row level security;

-- No anon policies — all writes go through Netlify (service role bypasses RLS).
-- Add a read policy here later if you want a public dashboard.

-- Index for common query patterns
create index if not exists app_events_slug_name_idx
  on app_events (app_slug, event_name, created_at desc);

create index if not exists app_events_device_idx
  on app_events (device_id, created_at desc);


-- 2. app_feedback ────────────────────────────────────────────────────────────
--    Written exclusively by the Netlify function (service role key).

create table if not exists app_feedback (
  id          bigserial    primary key,
  message     text         not null,
  email       text,
  app_slug    text         not null default 'unknown',
  url         text,
  device_id   text,
  created_at  timestamptz  not null default now()
);

alter table app_feedback enable row level security;

-- No anon policies — service role only via Netlify function.

create index if not exists app_feedback_slug_idx
  on app_feedback (app_slug, created_at desc);
