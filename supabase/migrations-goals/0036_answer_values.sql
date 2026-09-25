-- ===========================================================================
-- A date or an amount stored with each worked-out answer (plan #1035).
--
-- #992 settled that a closed information step reopens only when a rewritten
-- answer differs from the old one, and #998 that a date differs when it moves
-- at all and an amount when it moves by more than a margin (#1033: more than
-- 5%). Comparing the sentences would reopen the step whenever the routine
-- rewords one, so each answer now carries the value it states beside its
-- wording, and the comparison reads the value.
--
--   answers.kind          'date', 'amount' or 'text'. What the answer states:
--                         a day ("18 Dec 2026"), a dollar amount ("about
--                         $2,450 a month"), or anything else (which company
--                         services the loans). Text by default.
--   answers.value_date    the day a date answer states. Set only on a date.
--   answers.value_amount  the amount an amount answer states, in dollars.
--                         Set only on an amount.
--
-- #1047 settled that the 5% is measured from the answer as it stood when the
-- step last closed, so that small monthly rises add up. The answer keeps that
-- closing state beside the current one:
--
--   answers.closed_answer, closed_date, closed_amount
--                         the answer's wording and value when its step last
--                         closed. Written by the trigger below whenever an
--                         information step goes to done, by any path; null
--                         for an answer whose step has not closed since it
--                         was written.
--
-- The rule that reads these (what counts as a change) is
-- lib/goals/answer-change.ts. Reopening the step on it is plan #997's.
-- ===========================================================================

alter table goals.answers
  add column kind text not null default 'text',
  add column value_date date,
  add column value_amount numeric(14, 2),
  add column closed_answer text,
  add column closed_date date,
  add column closed_amount numeric(14, 2);

alter table goals.answers
  add constraint answers_kind_ck check (kind in ('date', 'amount', 'text')),
  add constraint answers_value_ck check (
    case kind
      when 'date' then value_date is not null and value_amount is null
      when 'amount' then value_amount is not null and value_date is null
      else value_date is null and value_amount is null
    end
  ),
  add constraint answers_closed_ck check (closed_date is null or closed_amount is null);

comment on column goals.answers.kind is
  'What the answer states: date, amount or text (plan #1035). A date or amount carries its value in value_date or value_amount.';
comment on column goals.answers.value_date is 'The day a date answer states (plan #1035).';
comment on column goals.answers.value_amount is 'The dollar amount an amount answer states (plan #1035).';
comment on column goals.answers.closed_answer is
  'The answer as it stood when its step last closed; changes are measured from it (plan #1047).';
comment on column goals.answers.closed_date is 'value_date when the step last closed (plan #1047).';
comment on column goals.answers.closed_amount is 'value_amount when the step last closed (plan #1047).';

-- ---------------------------------------------------------------------------
-- answers_check, as 0034 wrote it, with the typed value counting as a
-- rewrite: a changed kind or value dates the answer again and clears
-- out_of_date_at, the same as changed wording.
-- ---------------------------------------------------------------------------
create or replace function goals.answers_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  step_level text;
  step_collection uuid;
  src jsonb;
begin
  select level, collection_id into step_level, step_collection
  from goals.items where id = new.item_id and user_id = new.user_id;
  if step_level is distinct from 'step' or step_collection is null then
    raise exception 'An answer belongs on an information step: a step that fills a collection.'
      using errcode = 'check_violation', constraint = 'answers_item_is_information_step';
  end if;

  if jsonb_typeof(new.sources) is distinct from 'array' then
    raise exception 'Sources are a list of {"record_id": "<uuid>", "as_of": "YYYY-MM-DD"}.'
      using errcode = 'check_violation', constraint = 'answers_sources_shape';
  end if;
  for src in select value from jsonb_array_elements(new.sources) loop
    if jsonb_typeof(src) <> 'object'
       or jsonb_typeof(src -> 'record_id') is distinct from 'string'
       or (src ->> 'record_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(src -> 'as_of') is distinct from 'string'
       or (src ->> 'as_of') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Each source is {"record_id": "<uuid>", "as_of": "YYYY-MM-DD"}: %', src
        using errcode = 'check_violation', constraint = 'answers_sources_shape';
    end if;
    if not exists (
      select 1 from goals.records r
      where r.id = (src ->> 'record_id')::uuid and r.user_id = new.user_id
    ) then
      raise exception 'Source % is not one of your records.', src ->> 'record_id'
        using errcode = 'check_violation', constraint = 'answers_sources_records';
    end if;
  end loop;

  if tg_op = 'INSERT' then
    new.worked_at := now();
    new.out_of_date_at := null;
  elsif new.answer is distinct from old.answer
     or new.sources is distinct from old.sources
     or new.question is distinct from old.question
     or new.kind is distinct from old.kind
     or new.value_date is distinct from old.value_date
     or new.value_amount is distinct from old.value_amount then
    new.worked_at := now();
    new.out_of_date_at := null;
  elsif old.out_of_date_at is not null and new.out_of_date_at is null then
    new.worked_at := now();
  end if;

  return new;
end;
$$;

revoke all on function goals.answers_check() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- When an information step closes, by any path (the questions all answered,
-- the person pressing done, the routine), its answers keep what they said at
-- that moment as the baseline the next change is measured from.
-- ---------------------------------------------------------------------------
create or replace function goals.items_keep_closed_answers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.collection_id is not null then
    update goals.answers a
       set closed_answer = a.answer,
           closed_date = a.value_date,
           closed_amount = a.value_amount
     where a.item_id = new.id
       and a.user_id = new.user_id;
  end if;
  return null;
end;
$$;

revoke all on function goals.items_keep_closed_answers() from public, anon, authenticated;

create trigger items_keep_closed_answers after update of status on goals.items
  for each row execute function goals.items_keep_closed_answers();

-- Answers on a step already closed take their current state as the baseline.
update goals.answers a
   set closed_answer = a.answer,
       closed_date = a.value_date,
       closed_amount = a.value_amount
  from goals.items i
 where i.id = a.item_id
   and i.status = 'done';

notify pgrst, 'reload schema';
