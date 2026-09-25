-- ===========================================================================
-- The questions an information step has to answer, and closing the step once
-- each has an answer (plan #991).
--
-- #988 settled that an information step closes when its questions are
-- answered, not when its fields are filled. The fields are how the answers
-- are reached; the step is done when the answers are there.
--
--   items.questions   the questions the step has to answer, in order:
--                     [{"key": "first_payment",
--                       "question": "When does my first payment fall due?"}].
--                     `key` is the same key the question's row in
--                     goals.answers carries (0034). Only an information step
--                     has questions. The person edits them on the step; the
--                     goals routine writes them when it maps a goal.
--
-- A question is answered when goals.answers has a row with its key on the
-- step that names at least one source and is not out of date. When every
-- question on an open step is answered, the step closes. That is checked in
-- the database, below, when an answer is written and when the questions
-- change, because the answers are written by the routine through SQL and the
-- page never sees that write. A step with no questions never closes itself;
-- the person closes it.
--
-- A closed step whose answer later goes out of date stays closed here; what
-- happens to it then is plan #997's.
-- ===========================================================================

create or replace function goals.questions_valid(questions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(questions) = 'array'
     and jsonb_array_length(questions) between 1 and 20
     and not exists (
       select 1 from jsonb_array_elements(questions) q
       where jsonb_typeof(q) <> 'object'
          or jsonb_typeof(q -> 'key') is distinct from 'string'
          or (q ->> 'key') !~ '^[a-z][a-z0-9_]{0,39}$'
          or jsonb_typeof(q -> 'question') is distinct from 'string'
          or btrim(q ->> 'question') = ''
          or length(q ->> 'question') > 300
     )
     and (
       select count(distinct q ->> 'key') from jsonb_array_elements(questions) q
     ) = jsonb_array_length(questions);
$$;

revoke all on function goals.questions_valid(jsonb) from public, anon;
grant execute on function goals.questions_valid(jsonb) to authenticated, service_role;

alter table goals.items add column questions jsonb;

alter table goals.items
  add constraint items_questions_ck check (
    questions is null or (collection_id is not null and goals.questions_valid(questions))
  );

comment on column goals.items.questions is
  'The questions an information step has to answer, [{"key", "question"}] in order. Each key matches a row of goals.answers; the step closes once every question has a current answer with sources (plan #991).';

-- ---------------------------------------------------------------------------
-- Close an open information step whose every question has a current answer
-- with sources. Runs as the caller, so a person's write reaches only their
-- own step. True when it closed the step.
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

revoke all on function goals.close_answered_step(uuid) from public, anon;
grant execute on function goals.close_answered_step(uuid) to authenticated, service_role;

create or replace function goals.answers_close_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform goals.close_answered_step(new.item_id);
  return null;
end;
$$;

revoke all on function goals.answers_close_step() from public, anon, authenticated;

create trigger answers_close_step after insert or update on goals.answers
  for each row execute function goals.answers_close_step();

create or replace function goals.items_questions_close_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.questions is distinct from old.questions then
    perform goals.close_answered_step(new.id);
  end if;
  return null;
end;
$$;

revoke all on function goals.items_questions_close_step() from public, anon, authenticated;

create trigger items_questions_close_step after update of questions on goals.items
  for each row execute function goals.items_questions_close_step();

notify pgrst, 'reload schema';
