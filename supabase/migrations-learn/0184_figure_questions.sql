-- Figure questions (plan #2321.5).
--
--   cell_questions.format 'figure'
--       a question that asks somebody to use a figure rather than write a
--       paragraph: fill a table's blank cell, say which way a chart went
--       after the year it stops at, pick the right diagram. It is asked in
--       an explanation's place, at the levels an explanation is (1 to 3 and
--       7 to 9), and graded on the asked cell alone, so it never shows more
--       than an explanation could. Its evidence is written to cell_evidence
--       by the same code and the same rules as any other answer.
--   cell_questions.figure
--       the question as posed, kept whole so it reads the same when shown
--       again and grading never fetches: {kind, form, caption, spec,
--       resolved?, prompt, choices?, answer}. kind and form name entries in
--       the figure registry (lib/learn/figures/registry.ts); spec and
--       resolved are the figure as shown, with the blank or the cut; answer
--       is never sent to the page. Null on every other format.
--
-- Schema only: no row is changed.

set search_path = learn, public, extensions;

alter table learn.cell_questions add column if not exists figure jsonb;

alter table learn.cell_questions drop constraint if exists cell_questions_format_ck;
alter table learn.cell_questions
  add constraint cell_questions_format_ck check (format in ('explain', 'case', 'defend', 'figure'));

alter table learn.cell_questions drop constraint if exists cell_questions_figure_ck;
alter table learn.cell_questions
  add constraint cell_questions_figure_ck
    check ((format = 'figure') = (figure is not null) and (figure is null or jsonb_typeof(figure) = 'object'));

comment on column learn.cell_questions.figure is
  'A figure question as posed (plan #2321.5): {kind, form, caption, spec, resolved?, prompt, choices?, answer}. Null unless format is figure.';
