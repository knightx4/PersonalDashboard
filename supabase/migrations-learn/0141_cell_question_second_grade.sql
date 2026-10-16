-- A second grader's verdict kept beside the first (plan #2138.12).
--
-- Every answer is read by two graders so the measurement feature can say how
-- often they agree. `grade` stays the first grader's and is the only one that
-- writes cell_evidence; `grade_second` has the same shape,
-- [{cell_id, verdict, quote, reason}], and is read only for agreement.
-- Null when the second call failed or the answer was graded before this column.

set search_path = learn, public, extensions;

alter table learn.cell_questions
  add column grade_second jsonb,
  add column model_second text;

alter table learn.cell_questions
  add constraint cell_questions_grade_second_ck
    check (grade_second is null or (grade is not null and jsonb_typeof(grade_second) = 'array'));
