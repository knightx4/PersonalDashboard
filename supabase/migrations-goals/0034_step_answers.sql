-- ===========================================================================
-- Worked-out answers on an information step (plan #989).
--
-- An information step exists to answer something: when the loan payments
-- start, what they come to a month. The fields are the means. The goals
-- routine works each answer out from the step's records and stores it here,
-- one row per question, with the rows and the dates of the figures it read.
-- The step shows these answers above its figures (docs/GOALS-SPEC.md,
-- "Information steps and collections").
--
--   answers.key             names the question on its step, lower case,
--                           digits and _ ("first_payment"). One row per key.
--   answers.question        the question, as the step shows it
--   answers.answer          the answer, one sentence
--   answers.sources         the rows read: [{"record_id": "<uuid>",
--                           "as_of": "YYYY-MM-DD"}], where as_of is the date
--                           of that row's figures (records.as_of, or the date
--                           the values were typed when it has none)
--   answers.worked_at       when the answer was last worked out. Kept by the
--                           trigger below.
--   answers.out_of_date_at  set when a row the answer read has changed since,
--                           or a new row arrived in the collection the step
--                           fills. The morning run works an out-of-date
--                           answer again; rewriting it clears this.
--
-- The answers are the routine's, never typed on the page. What makes one out
-- of date is a trigger on goals.records, so a change from any path (a save on
-- the page, a document read, the routine) counts.
-- ===========================================================================

create table goals.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  key text not null,
  question text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  run_id uuid,

  worked_at timestamptz not null default now(),
  out_of_date_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint answers_id_user_key unique (id, user_id),
  constraint answers_key_key unique (item_id, key),

  constraint answers_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint answers_run_fk foreign key (run_id, user_id)
    references goals.runs (id, user_id) on delete set null (run_id),

  constraint answers_key_ck check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint answers_question_ck check (btrim(question) <> '' and length(question) <= 300),
  constraint answers_answer_ck check (btrim(answer) <> '' and length(answer) <= 1000),
  constraint answers_sources_ck check (
    jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 200
  )
);

create index answers_item_idx on goals.answers (item_id);
create index answers_sources_idx on goals.answers using gin (sources jsonb_path_ops);
create index answers_out_of_date_idx on goals.answers (user_id)
  where out_of_date_at is not null;

-- ---------------------------------------------------------------------------
-- The shape of an answer: on an information step, with sources that name
-- rows of yours and the dates of their figures. Rewriting the answer or its
-- sources dates it again and clears out_of_date_at; so does clearing
-- out_of_date_at by hand, for an answer the routine checked and left as it
-- was.
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

create trigger answers_check before insert or update on goals.answers
  for each row execute function goals.answers_check();

create trigger answers_touch_updated_at before update on goals.answers
  for each row execute function goals.touch_updated_at();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context', 'answers'
  )
);

create trigger answers_history after insert or update or delete on goals.answers
  for each row execute function goals.record_history();

alter table goals.answers enable row level security;

create policy answers_all on goals.answers for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.answers from anon, public;
grant select, insert, update, delete on goals.answers to authenticated, service_role;

comment on table goals.answers is
  'Worked-out answers on an information step ("payments start 18 Dec 2026"), written by the goals routine from the step''s records, with the rows and dates of the figures read. Marked out of date when one of those rows changes.';

-- ---------------------------------------------------------------------------
-- A row changing makes the answers that read it out of date.
--
--   - a row an answer names in its sources changes its values, its date, or
--     is archived or restored;
--   - a new confirmed row arrives, or a draft is confirmed, in the collection
--     an answered step fills: a new loan changes the monthly total even
--     though no answer read it yet.
--
-- A draft arriving counts for nothing until it is confirmed, as everywhere
-- else on an information step. An answer already out of date keeps the time
-- it first went out of date.
-- ---------------------------------------------------------------------------
create or replace function goals.records_outdate_answers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.data is not distinct from old.data
     and new.as_of is not distinct from old.as_of
     and new.archived_at is not distinct from old.archived_at
     and new.draft is not distinct from old.draft then
    return new;
  end if;

  update goals.answers a
     set out_of_date_at = now()
   where a.user_id = new.user_id
     and a.out_of_date_at is null
     and (
       a.sources @> jsonb_build_array(jsonb_build_object('record_id', new.id::text))
       or (
         not new.draft
         and new.archived_at is null
         and (tg_op = 'INSERT' or old.draft)
         and exists (
           select 1 from goals.items i
           where i.id = a.item_id and i.user_id = new.user_id
             and i.collection_id = new.collection_id
         )
       )
     );
  return new;
end;
$$;

revoke all on function goals.records_outdate_answers() from public, anon, authenticated;

create trigger records_outdate_answers after insert or update on goals.records
  for each row execute function goals.records_outdate_answers();

notify pgrst, 'reload schema';
