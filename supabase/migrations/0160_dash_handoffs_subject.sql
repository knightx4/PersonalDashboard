-- Which row an Ask Dash hand-off is about (plan #1568).
--
-- A job, todo or return that Dash has handed on to the backup routine should
-- read "Dash is on it" while the routine works, and for that the page has to
-- know which row the hand-off is for. Dash names the row when it hands the
-- request on, using a row a lookup returned or the row the page showed.
--
--   subject_ref  the row, as a ref (`schema.table:id`, lib/core/refs.ts).
--                Null when the request is not about one row. Refs carry no
--                foreign key, so the row may since have gone.

set search_path = core, public, extensions;

alter table core.dash_handoffs add column subject_ref text;

alter table core.dash_handoffs add constraint dash_handoffs_subject_ref_ck
  check (subject_ref is null or (char_length(subject_ref) <= 200 and subject_ref ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:.+$'));

-- The open hand-offs that name a row, which the Jobs, Todo and Shopping pages
-- read to mark those rows.
create index dash_handoffs_subject_open_idx on core.dash_handoffs (user_id)
  where status in ('pending', 'fired') and subject_ref is not null;

comment on column core.dash_handoffs.subject_ref is
  'The row the request is about, as a ref (schema.table:id), or null (plan #1568).';
