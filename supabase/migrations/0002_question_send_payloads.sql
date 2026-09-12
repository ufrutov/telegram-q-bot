-- Durable callback context for answer and hint buttons.
--
-- Redis used to hold these payloads for 24 hours. Keeping them on the
-- question-send row means existing Telegram buttons remain usable after that
-- window, without changing their callback_data format.
alter table "tq-bot-question_sends"
  add column if not exists answer_payload jsonb,
  add column if not exists hint_payload jsonb;

comment on column "tq-bot-question_sends".answer_payload is
  'Answer text, answer preview URLs, optional pack ID, and media reply target for an answer callback.';
comment on column "tq-bot-question_sends".hint_payload is
  'Question source data required to generate a hint after the question is sent.';
