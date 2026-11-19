create or replace function tq_bot_get_answer_streak(p_chat_id uuid)
returns bigint
language sql
stable
as $$
  with question_sequence as (
    select
      array_agg(qs.id order by qs.created_at, qs.id) as send_ids,
      min(qs.created_at) as first_sent_at,
      bool_or(qs.question_answered is true) as answered
    from "tq-bot-question_sends" qs
    where qs.chat_id = p_chat_id
      and not qs.is_integration_test
    group by qs.question_id, case when qs.question_id is null then qs.id end
  ),
  ordered_questions as (
    select answered,
           row_number() over (order by first_sent_at desc, send_ids[1] desc) as position
    from question_sequence
  )
  select coalesce(min(position) filter (where not answered) - 1, count(*))
  from ordered_questions;
$$;

revoke execute on function tq_bot_get_answer_streak(uuid) from public, anon, authenticated;
grant execute on function tq_bot_get_answer_streak(uuid) to service_role;
