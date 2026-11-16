-- Apply manually in Supabase before deploying dashboard hint configuration.
alter table "tq-bot-chats"
  add column hint_provider text check (hint_provider in ('gemini', 'openrouter')),
  add column hint_model text check (length(hint_model) between 1 and 180),
  add constraint "tq-bot-chats_hint_config_pair"
    check ((hint_provider is null) = (hint_model is null));

