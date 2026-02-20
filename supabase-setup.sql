-- ─────────────────────────────────────────────────────────────────
-- Kapework · Supabase one-time setup
-- Run this in your Supabase project → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────────

-- 1. plays -----------------------------------------------------------
create table if not exists plays (
  id         bigserial primary key,
  slug       text        not null,
  device_id  text,
  created_at timestamptz not null default now()
);

alter table plays enable row level security;

-- Allow anonymous inserts (anyone can record a play)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'plays' and policyname = 'anon insert plays'
  ) then
    create policy "anon insert plays"
      on plays for insert to anon with check (true);
  end if;
end $$;

-- Allow anonymous reads (needed so the view works via REST)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'plays' and policyname = 'anon read plays'
  ) then
    create policy "anon read plays"
      on plays for select to anon using (true);
  end if;
end $$;

-- 2. likes -----------------------------------------------------------
create table if not exists likes (
  id         bigserial primary key,
  slug       text        not null,
  device_id  text,
  created_at timestamptz not null default now()
);

alter table likes enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'likes' and policyname = 'anon insert likes'
  ) then
    create policy "anon insert likes"
      on likes for insert to anon with check (true);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'likes' and policyname = 'anon read likes'
  ) then
    create policy "anon read likes"
      on likes for select to anon using (true);
  end if;
end $$;

-- 3. feedback --------------------------------------------------------
create table if not exists feedback (
  id         bigserial primary key,
  slug       text        not null default 'general',
  message    text        not null,
  created_at timestamptz not null default now()
);

alter table feedback enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'feedback' and policyname = 'anon insert feedback'
  ) then
    create policy "anon insert feedback"
      on feedback for insert to anon with check (true);
  end if;
end $$;

-- 4. Count views -----------------------------------------------------
create or replace view game_play_counts as
  select slug, count(*)::bigint as plays
  from plays
  group by slug;

create or replace view game_like_counts as
  select slug, count(*)::bigint as likes
  from likes
  group by slug;

-- Grant anon SELECT on the views (required for Supabase REST API)
grant select on game_play_counts to anon;
grant select on game_like_counts to anon;
