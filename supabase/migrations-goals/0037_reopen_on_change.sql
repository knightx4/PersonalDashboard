-- ===========================================================================
-- Reopen a closed information step when a rewritten answer changes
-- (plan #997).
--
-- #992 settled that a closed information step comes back when the goals
-- routine rewrites one of its answers and the new answer differs from the
-- old; a statement that confirms what the step already said leaves it
-- closed. What "differs" means was settled after:
--
--   - a date differs when it moves at all (#998);
--   - an amount differs when it moves by more than 5% (#1033);
--   - both are measured from the answer as it stood when the step last
--     closed (#1047), which 0036 keeps in closed_answer, closed_date and
--     closed_amount;
--   - a written answer differs when its meaning changes, judged by the
--     routine (#1034). Until plan #1036 stores that verdict, a written answer
--     is compared on its wording, ignoring case and spacing.
--
-- goals.answer_moved below is lib/goals/answer-change.ts (answerChange) in
-- SQL, since the routine writes answers through SQL and this is the one place
-- every write passes. The two must agree; the page reads the TypeScript one
-- to say what moved.
--
--   answers.changed_at         when a rewrite changed this answer and
--                              reopened its step; null otherwise. Cleared
--                              when the step next closes.
--   answers.changed_record_id  the row behind the change: of the rows the
--                              new answer read, the one most recently
--                              updated. The page names the document it came
--                              from.
--
-- A step reopened this way does not close itself again when its answers are
-- current, which 0035's rule would otherwise do on the same write. What does
-- close it is decision #1048's to settle; until then it closes the way any
-- step does, by being set done, and closing it takes the answers as they
-- stand as the baseline for the next change.
-- ===========================================================================

alter table goals.answers
  add column changed_at timestamptz,
  add column changed_record_id uuid,
  add constraint answers_changed_record_fk foreign key (changed_record_id, user_id)
    references goals.records (id, user_id) on delete set null (changed_record_id);

comment on column goals.answers.changed_at is
  'When a rewrite changed this answer and reopened its closed step (plan #997); cleared when the step closes again.';
comment on column goals.answers.changed_record_id is
  'The row behind the change: the most recently updated of the rows the changed answer read (plan #997).';

-- ---------------------------------------------------------------------------
-- Whether an answer moved from its baseline to its new state, by the rules
-- above. A date and a date compare the day; an amount and an amount compare
-- in whole cents against 5% of the baseline; anything else compares wording.
-- ---------------------------------------------------------------------------
create or replace function goals.answer_moved(
  was_kind text, was_answer text, was_date date, was_amount numeric,
  now_kind text, now_answer text, now_date date, now_amount numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when was_kind = 'date' and now_kind = 'date' then was_date is distinct from now_date
    when was_kind = 'amount' and now_kind = 'amount' then
      case
        when round(abs(was_amount) * 100) = 0 then round(abs(now_amount - was_amount) * 100) > 0
        else round(abs(now_amount - was_amount) * 100) * 100 > round(abs(was_amount) * 100) * 5
      end
    else
      lower(regexp_replace(btrim(was_answer), '\s+', ' ', 'g'))
        is distinct from lower(regexp_replace(btrim(now_answer), '\s+', ' ', 'g'))
  end;
$$;

revoke all on function goals.answer_moved(text, text, date, numeric, text, text, date, numeric) from public, anon;
grant execute on function goals.answer_moved(text, text, date, numeric, text, text, date, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Before a rewrite lands on an answer whose step is done: when the answer
-- moved from its baseline, mark it changed. The baseline is the closing state
-- when there is one, or the answer as it stood before this write for one
-- written after the step closed; the latter is kept as the closing state so
-- the page can show what it was.
-- ---------------------------------------------------------------------------
create or replace function goals.answers_mark_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  step_status text;
  was_kind text;
begin
  if new.answer is not distinct from old.answer
     and new.kind is not distinct from old.kind
     and new.value_date is not distinct from old.value_date
     and new.value_amount is not distinct from old.value_amount then
    return new;
  end if;

  select status into step_status
  from goals.items where id = new.item_id and user_id = new.user_id;
  if step_status is distinct from 'done' then
    return new;
  end if;

  if old.closed_answer is null then
    new.closed_answer := old.answer;
    new.closed_date := old.value_date;
    new.closed_amount := old.value_amount;
  end if;

  was_kind := case
    when new.closed_date is not null then 'date'
    when new.closed_amount is not null then 'amount'
    else 'text'
  end;
  if goals.answer_moved(was_kind, new.closed_answer, new.closed_date, new.closed_amount,
                        new.kind, new.answer, new.value_date, new.value_amount) then
    new.changed_at := now();
    new.changed_record_id := (
      select r.id from goals.records r
      where r.user_id = new.user_id
        and r.id in (
          select (s ->> 'record_id')::uuid from jsonb_array_elements(new.sources) s
        )
      order by r.updated_at desc, r.id
      limit 1
    );
  end if;
  return new;
end;
$$;

revoke all on function goals.answers_mark_change() from public, anon, authenticated;

-- Named to run after answers_check, which has already checked the sources.
create trigger answers_mark_change before update on goals.answers
  for each row execute function goals.answers_mark_change();

-- ---------------------------------------------------------------------------
-- After an answer is marked changed, reopen its step. Runs after
-- answers_close_step (names run in order), which leaves a done step alone.
-- ---------------------------------------------------------------------------
create or replace function goals.answers_reopen_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.changed_at is not null and old.changed_at is null then
    update goals.items
       set status = 'open'
     where id = new.item_id
       and user_id = new.user_id
       and status = 'done';
  end if;
  return null;
end;
$$;

revoke all on function goals.answers_reopen_step() from public, anon, authenticated;

create trigger answers_reopen_step after update on goals.answers
  for each row execute function goals.answers_reopen_step();

-- ---------------------------------------------------------------------------
-- close_answered_step, as 0035 wrote it, leaving alone a step with a change
-- still standing on one of its answers.
-- ---------------------------------------------------------------------------
create or replace function goals.close_answered_step(step uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update goals.items i
     set status = 'done'
   where i.id = step
     and i.level = 'step'
     and i.status = 'open'
     and i.archived_at is null
     and i.collection_id is not null
     and i.questions is not null
     and not exists (
       select 1 from goals.answers a
       where a.item_id = i.id
         and a.user_id = i.user_id
         and a.changed_at is not null
     )
     and not exists (
       select 1 from jsonb_array_elements(i.questions) q
       where not exists (
         select 1 from goals.answers a
         where a.item_id = i.id
           and a.user_id = i.user_id
           and a.key = q ->> 'key'
           and a.out_of_date_at is null
           and jsonb_array_length(a.sources) > 0
       )
     );
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- items_keep_closed_answers, as 0036 wrote it, also clearing the change: a
-- step closing again takes its answers as they stand as the new baseline.
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
           closed_amount = a.value_amount,
           changed_at = null,
           changed_record_id = null
     where a.item_id = new.id
       and a.user_id = new.user_id;
  end if;
  return null;
end;
$$;

notify pgrst, 'reload schema';
