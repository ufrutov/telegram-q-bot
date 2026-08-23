-- supabase/migrations/0000_drop_everything.sql
--
-- Run once before re-applying 0001_init.sql to start over.
-- Drops every object this integration owns. Order matters: drop functions
-- and policies before the tables they reference.

-- Functions
drop function if exists tq_bot_get_stats(uuid, timestamptz);
drop function if exists tq_bot_add_cron_job(uuid, time, text, int);

-- Tables (CASCADE drops FK references and indexes)
drop table if exists "tq-bot-load_failures" cascade;
drop table if exists "tq-bot-question_sends" cascade;
drop table if exists "tq-bot-cron_jobs" cascade;
drop table if exists "tq-bot-chats" cascade;
