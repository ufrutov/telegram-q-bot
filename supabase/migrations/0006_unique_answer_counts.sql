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
  with scoped_sends as (
    select qs.id, qs.question_id, qs.complexity, qs.hint_asked, qs.hint_failed,
           qs.question_answered, qs.created_at
    from "tq-bot-question_sends" qs
    where qs.chat_id = p_chat_id
      and (p_since is null or qs.created_at >= p_since)
  ),
  answered_sends as (
    -- Use the earliest marked send in the window for the difficulty breakdown.
    -- Legacy sends without a question ID still count individually.
    select distinct on (question_id, case when question_id is null then id end) id
    from scoped_sends
    where question_answered
    order by question_id, case when question_id is null then id end, created_at, id
  ),
  sends as (
    select
      qs.complexity,
      count(*) as loaded,
      count(*) filter (where qs.hint_asked) as hints_asked,
      count(*) filter (where qs.hint_failed) as hints_failed,
      count(answered_sends.id) as answered
    from scoped_sends qs
    left join answered_sends on answered_sends.id = qs.id
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

-- With chat IDs, return counts for the requested chats. With NULL, return a
-- single overview total that counts the same question separately in each chat.
create or replace function tq_bot_get_answer_counts(p_chat_ids uuid[])
returns table (chat_id uuid, answered bigint)
language sql
stable
as $$
  with chat_counts as (
    select qs.chat_id,
           count(distinct qs.question_id) +
             count(*) filter (where qs.question_id is null) as answered
    from "tq-bot-question_sends" qs
    where qs.question_answered
      and not qs.is_integration_test
      and (p_chat_ids is null or qs.chat_id = any(p_chat_ids))
    group by qs.chat_id
  )
  select cc.chat_id, cc.answered
  from chat_counts cc
  where p_chat_ids is not null
  union all
  select null::uuid, coalesce(sum(cc.answered), 0)::bigint
  from chat_counts cc
  having p_chat_ids is null;
$$;

revoke execute on function tq_bot_get_answer_counts(uuid[]) from public, anon, authenticated;
grant execute on function tq_bot_get_answer_counts(uuid[]) to service_role;
