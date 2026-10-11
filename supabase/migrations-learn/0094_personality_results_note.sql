-- A line of the person's own beside a personality result (plan #1633, under #1630).
--
-- When a type is typed in from another test, the compose form takes an
-- optional line with it: where the test was taken, how sure they are of the
-- result, anything they would want Dash to know when it reads the type
-- against their notes (#1635). Null when they wrote nothing. Any kind may
-- carry one, though only the typed-in form asks for it today.

set search_path = learn, public, extensions;

alter table learn.personality_results
  add column if not exists note text;

alter table learn.personality_results
  add constraint personality_results_note_ck
    check (note is null or length(btrim(note)) between 1 and 500);

comment on column learn.personality_results.note is
  'An optional line of the person''s own about the result, up to 500 characters (plan #1633).';
