-- The three questions every design check answers (plan #1891.1,
-- docs/UI-QUALITY-SPEC.md Part 2 and R19).
--
-- Each critic round now says where the eye goes first, whether anything
-- competes with the data, and whether the lines are lighter than the text.
-- The answers are kept whole, as the critic wrote them, beside the fixes:
-- `{"eye": {...}, "competition": {...}, "lines": {...}}`, each with an
-- `answer` and an `ok`. The recorder (lib/preview/ui-checks.ts) refuses a
-- verdict that leaves one out, so the database only checks the shape.
--
-- A round recorded before this, and an `accepted` round the person writes,
-- keeps the empty object.

set search_path = public, extensions;

alter table ui_checks add column if not exists questions jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ui_checks_questions_ck') then
    alter table ui_checks
      add constraint ui_checks_questions_ck check (jsonb_typeof(questions) = 'object');
  end if;
end $$;
