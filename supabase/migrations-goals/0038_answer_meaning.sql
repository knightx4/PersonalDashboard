-- ===========================================================================
-- Judge a written answer by its meaning before reopening its step
-- (plan #1036).
--
-- #1034 settled that a written answer reopens its closed step only when its
-- meaning changes, and that the goals routine says whether it did, with one
-- line on why. "Nelnet" rewritten as "Nelnet Servicing" names the same
-- servicer and leaves the step closed; "MOHELA" names another and reopens it.
-- 0037 compared written answers on their wording until this verdict was
-- stored.
--
--   answers.meaning_changed  the routine's verdict on its latest rewrite:
--                            whether the meaning moved from the answer the
--                            step closed with. Null when it gave none.
--   answers.meaning_reason   the one line on why, shown beside the old and
--                            new answer on a reopened step. Set exactly when
--                            meaning_changed is.
--
-- The verdict is read for a written answer and for one whose kind changed; a
-- date or an amount keeps its own rule (#998, #1033). A verdict belongs to
-- the rewrite it came with: a rewrite that changes the answer and leaves the
-- verdict as it was clears it, and the answer is then compared on its wording
-- (case and spacing aside), so a change nobody judged still shows.
-- lib/goals/answer-change.ts (answerChange) applies the same rule, and the
-- two must agree.
-- ===========================================================================

alter table goals.answers
  add column meaning_changed boolean,
  add column meaning_reason text,
  add constraint answers_meaning_verdict check (
    (meaning_changed is null and meaning_reason is null)
    or (meaning_changed is not null and meaning_reason is not null
        and length(btrim(meaning_reason)) > 0)
  );

comment on column goals.answers.meaning_changed is
  'The goals routine''s verdict on its latest rewrite of a written answer: whether the meaning changed from the answer the step closed with (plan #1036). Null when it gave none.';
comment on column goals.answers.meaning_reason is
  'The routine''s one line on why the meaning did or did not change, shown on a reopened step (plan #1036).';

-- ---------------------------------------------------------------------------
-- answer_moved, as 0037 wrote it, reading the verdict where a date or an
-- amount does not settle it. Replaces the eight-argument form.
-- ---------------------------------------------------------------------------
drop function goals.answer_moved(text, text, date, numeric, text, text, date, numeric);

create function goals.answer_moved(
  was_kind text, was_answer text, was_date date, was_amount numeric,
  now_kind text, now_answer text, now_date date, now_amount numeric,
  meaning_changed boolean
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
    when meaning_changed is not null then meaning_changed
    else
      lower(regexp_replace(btrim(was_answer), '\s+', ' ', 'g'))
        is distinct from lower(regexp_replace(btrim(now_answer), '\s+', ' ', 'g'))
  end;
$$;

revoke all on function goals.answer_moved(text, text, date, numeric, text, text, date, numeric, boolean)
  from public, anon;
grant execute on function goals.answer_moved(text, text, date, numeric, text, text, date, numeric, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- answers_check, as 0036 wrote it, with two additions: a changed verdict
-- counts as a rewrite, and a rewrite that leaves the verdict as it was drops
-- it, since it judged the answer before.
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
  rewritten boolean;
  verdict_moved boolean;
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
    return new;
  end if;

  rewritten := new.answer is distinct from old.answer
     or new.kind is distinct from old.kind
     or new.value_date is distinct from old.value_date
     or new.value_amount is distinct from old.value_amount;
  verdict_moved := new.meaning_changed is distinct from old.meaning_changed
     or new.meaning_reason is distinct from old.meaning_reason;

  if rewritten and not verdict_moved then
    new.meaning_changed := null;
    new.meaning_reason := null;
  end if;

  if rewritten
     or verdict_moved
     or new.sources is distinct from old.sources
     or new.question is distinct from old.question then
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
-- answers_mark_change, as 0037 wrote it, passing the verdict and running on a
-- verdict-only update too, so a routine that revises its verdict on a done
-- step is heard.
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
     and new.value_amount is not distinct from old.value_amount
     and new.meaning_changed is not distinct from old.meaning_changed then
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
                        new.kind, new.answer, new.value_date, new.value_amount,
                        new.meaning_changed) then
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

notify pgrst, 'reload schema';
