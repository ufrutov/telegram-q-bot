-- Apply manually in Supabase before deploying the interaction guards.
alter table "tq-bot-chats"
  add column commands_enabled boolean not null default true,
  add column answer_buttons_enabled boolean not null default true;
