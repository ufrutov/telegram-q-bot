-- Marks rows created by the production-backed CI integration test.
-- The partial index supports inspection and safe cleanup without affecting
-- regular question-send queries.
alter table "tq-bot-question_sends"
  add column if not exists is_integration_test boolean not null default false;

create index if not exists "tq-bot-question_sends_integration_test"
  on "tq-bot-question_sends" (created_at desc)
  where is_integration_test;
