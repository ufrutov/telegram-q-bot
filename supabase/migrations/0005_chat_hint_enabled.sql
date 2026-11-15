-- Apply manually in Supabase before deploying hint settings.
alter table "tq-bot-chats"
  add column hint_enabled boolean not null default true;
