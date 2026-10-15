-- Questions asked about one level of a topic, and the answers to them
-- (docs/LEARN-LEVELS-SPEC.md, "How answers are graded"; plan #2138.5).
--
-- learn.probes is the claims graph's question record: every row names a
-- concept, and Practice Flow, the survey and the session counts read it
-- whole. A question about a cell has no concept, and a row of it there would
-- be served by readers that expect one. So a cell's questions get a table of
-- their own, and cell_evidence names the question it came from beside the
-- probe column the claims graph's migration will fill.
--
-- One row per question. `response` is what the person wrote, kept so a link
-- review can quote both answers that disagree; `grade` is what the grader
-- returned for every cell it was shown, before the code's rules (R1 to R3)
-- decided what to write. What was written is in cell_evidence.
--
-- `format` follows the level (lib/learn/levels/model.ts questionFormat):
-- explain at levels 1 to 3 and 7 to 9, a case at 4 to 6, a defence at 10.
-- A case carries the answer it expects; an explanation does not.

set search_path = learn, public, extensions;

create table learn.cell_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cell_id uuid not null,

  format text not null,
  question text not null,
  -- The answer a case expects. Null on an explanation.
  expected text,

  response text,
  answered_at timestamptz,
  -- Every verdict the grader returned, as [{cell_id, verdict, quote}], before
  -- the rules dropped any. Null until graded.
  grade jsonb,
  model text,

  created_at timestamptz not null default now(),

  constraint cell_questions_format_ck check (format in ('explain', 'case', 'defend')),
  constraint cell_questions_question_ck check (question <> ''),
  constraint cell_questions_expected_ck check (expected is null or expected <> ''),
  constraint cell_questions_case_ck check ((format = 'case') = (expected is not null)),
  constraint cell_questions_response_ck check (response is null or response <> ''),
  constraint cell_questions_answered_ck check ((response is null) = (answered_at is null)),
  constraint cell_questions_grade_ck check (grade is null or (response is not null and jsonb_typeof(grade) = 'array')),
  constraint cell_questions_user_id_uq unique (id, user_id),
  constraint cell_questions_cell_fk
    foreign key (cell_id, user_id) references learn.topic_cells (id, user_id) on delete cascade
);

create index if not exists cell_questions_cell_idx on learn.cell_questions (cell_id, created_at desc);
create index if not exists cell_questions_user_idx on learn.cell_questions (user_id, created_at desc);

alter table learn.cell_questions enable row level security;

create policy cell_questions_all on learn.cell_questions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.cell_questions from anon;
grant select, insert, update, delete on learn.cell_questions to authenticated, service_role;

-- Evidence names the cell question it came from. A row has at most one of
-- a probe and a question, and a declaration has neither.
alter table learn.cell_evidence add column question_id uuid;

alter table learn.cell_evidence
  add constraint cell_evidence_question_fk
    foreign key (question_id, user_id) references learn.cell_questions (id, user_id) on delete cascade;

alter table learn.cell_evidence
  add constraint cell_evidence_one_source_ck check (num_nonnulls(probe_id, question_id) <= 1);

alter table learn.cell_evidence
  add constraint cell_evidence_declared_question_ck check (verdict <> 'declared' or question_id is null);

create index if not exists cell_evidence_question_idx on learn.cell_evidence (question_id)
  where question_id is not null;
