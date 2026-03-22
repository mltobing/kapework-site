-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — app_errors
-- Run in: Supabase project → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Persistent error log written by Netlify Functions (service role key).
-- Replaces ephemeral console.error output that disappears with Lambda instances.
-- No anon read/write — admin inspection only (via Supabase dashboard or service role).

create table if not exists app_errors (
  id          bigserial    primary key,
  source      text         not null,          -- e.g. 'track-event', 'submit-feedback'
  message     text         not null,
  detail      jsonb,                           -- optional structured context
  created_at  timestamptz  not null default now()
);

alter table app_errors enable row level security;

-- No anon policies — all writes go through Netlify (service role bypasses RLS).

create index if not exists app_errors_source_idx
  on app_errors (source, created_at desc);

create index if not exists app_errors_created_idx
  on app_errors (created_at desc);
