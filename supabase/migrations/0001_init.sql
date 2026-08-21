-- supabase/migrations/0001_init.sql
--
-- Clean init. Apply via Supabase SQL editor or `psql -f`.
-- Tables are prefixed with `tq-bot-` so multiple projects can share one database.
-- All statements are idempotent (`if not exists`, `create or replace function`,
-- `drop ... if exists`) so re-running is safe.
--
-- To reset an existing database before re-applying, run the drops in
-- `0000_drop_everything.sql` first.
--
-- RLS: enabled on every table. The bot uses the SERVICE_ROLE key only, which
-- bypasses RLS, so no policies are required. If anyone ever uses anon or
-- authenticated keys, they will get "permission denied" — which is the
-- intended behavior for this server-only integration.

create extension if not exists "pgcrypto";

-- 1) Per-chat subscription (one row per chat OR chat+thread)
create table if not exists "tq-bot-chats" (
  id                uuid primary key default gen_random_uuid(),
  chat_id           bigint not null,
  thread_id         int,
  title             text,
  timezone          text not null default 'Europe/Chisinau',
  is_active         boolean not null default true,
  cron_enabled      boolean not null default false,
  cron_time         time not null default '12:00:00',
  cron_last_sent_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (chat_id, thread_id)
);
alter table "tq-bot-chats" enable row level security;

-- 2) Per-question lifecycle (created on success, mutated on hint)
create table if not exists "tq-bot-question_sends" (
  id                  bigint generated always as identity primary key,
  chat_id             uuid not null references "tq-bot-chats"(id) on delete cascade,
  telegram_message_id bigint not null,
  question_id         text,
  complexity          text check (complexity in ('random','easy','medium','hard')),
  hint_asked          boolean not null default false,
  hint_failed         boolean not null default false,
  hint_at             timestamptz,
  question_answered   boolean,
  meta                jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (chat_id, telegram_message_id)
);
create index if not exists "tq-bot-question_sends_chat_time"
  on "tq-bot-question_sends" (chat_id, created_at desc);
create index if not exists "tq-bot-question_sends_question"
  on "tq-bot-question_sends" (chat_id, question_id);
alter table "tq-bot-question_sends" enable row level security;

-- 3) Lightweight log of failed question loads
create table if not exists "tq-bot-load_failures" (
  id          bigint generated always as identity primary key,
  chat_id     uuid not null references "tq-bot-chats"(id) on delete cascade,
  complexity  text check (complexity in ('random','easy','medium','hard')),
  error       text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists "tq-bot-load_failures_chat_time"
  on "tq-bot-load_failures" (chat_id, created_at desc);
alter table "tq-bot-load_failures" enable row level security;

-- ---------------------------------------------------------------------------
-- Server-side helpers
--
-- Each function is a single round-trip that does the work atomically in
-- Postgres; the JS client calls them via Supabase `.rpc()`.
-- ---------------------------------------------------------------------------

-- /stats aggregation. Returns one row per complexity with counts of loaded,
-- hints_asked, hints_failed, and answered in the window. Plus a synthetic
-- row with complexity = '__failures__' that holds the failure count.
create or replace function tq_bot_get_stats(
  p_chat_id uuid,
  p_since timestamptz
)
returns table (
  complexity text,
  loaded bigint,
  hints_asked bigint,
  hints_failed bigint,
  answered bigint,
  failures bigint
)
language sql
stable
as $$
  with sends as (
    select
      qs.complexity,
      count(*) as loaded,
      count(*) filter (where qs.hint_asked) as hints_asked,
      count(*) filter (where qs.hint_failed) as hints_failed,
      count(*) filter (where qs.question_answered) as answered
    from "tq-bot-question_sends" qs
    where qs.chat_id = p_chat_id
      and (p_since is null or qs.created_at >= p_since)
    group by qs.complexity
  ),
  failures as (
    select count(*) as n
    from "tq-bot-load_failures" lf
    where lf.chat_id = p_chat_id
      and (p_since is null or lf.created_at >= p_since)
  )
  select
    s.complexity,
    s.loaded,
    s.hints_asked,
    s.hints_failed,
    s.answered,
    0::bigint as failures
  from sends s
  union all
  select
    '__failures__'::text as complexity,
    0::bigint,
    0::bigint,
    0::bigint,
    0::bigint,
    f.n
  from failures f;
$$;
