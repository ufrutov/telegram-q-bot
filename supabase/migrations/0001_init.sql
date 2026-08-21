-- supabase/migrations/0001_init.sql
--
-- Apply manually via Supabase SQL editor or `psql -f`.
-- Tables are prefixed with `tq-bot-` so multiple projects can share one database.
-- All statements are idempotent (`if not exists`) so re-running is safe.
--
-- RLS: enabled on every table. The bot uses the SERVICE_ROLE key only, which
-- bypasses RLS, so no policies are required. If anyone ever uses anon or
-- authenticated keys, they will get "permission denied" — which is the
-- intended behavior for this server-only integration.

create extension if not exists "pgcrypto";

-- 1) Per-chat subscription (one row per chat OR chat+thread)
create table if not exists "tq-bot-chats" (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  thread_id   int,
  title       text,
  timezone    text not null default 'Europe/Moscow',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (chat_id, thread_id)
);
alter table "tq-bot-chats" enable row level security;

-- 2) Per-chat schedule (up to 12 rows per chat)
create table if not exists "tq-bot-cron_jobs" (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references "tq-bot-chats"(id) on delete cascade,
  send_at      time not null,
  complexity   text not null default 'random'
                 check (complexity in ('random','easy','medium','hard')),
  is_enabled   boolean not null default true,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists "tq-bot-cron_jobs_enabled"
  on "tq-bot-cron_jobs" (chat_id) where is_enabled;
alter table "tq-bot-cron_jobs" enable row level security;

-- 3) Per-question lifecycle (created on success, mutated on hint)
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

-- 4) Lightweight log of failed question loads
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
