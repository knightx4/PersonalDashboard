-- ---------------------------------------------------------------------------
-- 0016 -- applications on you can be put off and dismissed on the agenda.
--
-- An application whose move is yours (the company replied, sent an
-- assessment, booked an interview, made an offer) is read from
-- job_search.applications at query time (lib/todo/agenda/sources/
-- applications.ts, plan #1475). Acting on it happens in the pipeline, so
-- "Later" and "Not this one" are about this list only and go in the
-- dismissal overlay.
--
-- The key is `applications:<application id>:<when the move came to you>`, so
-- putting off one turn leaves the next one to show.
-- ---------------------------------------------------------------------------

alter type todo.foreign_source add value if not exists 'application';
