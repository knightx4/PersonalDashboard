-- Pause the clocks behind the Learn the reader replaced.
--
-- The reader (learn 0195) and Courses (learn 0194) prepare nothing until the
-- person asks. Three jobs still worked for the card feed and the generated
-- subjects nobody opened (docs/LEARN-READER-SPEC.md, "Why this changes"):
--
--   feed-top-up-tick      hourly, writes cards for the old Now with a model
--   theme-placement-tick  hourly, places vault themes and Learn subjects
--   topic-import-tick     every ten minutes, the Wikipedia topic import
--
-- The person asked on 16 November 2026 for them to be turned off for now.
-- They are paused, not unscheduled, so cron.alter_job(jobid, active := true)
-- sets one going again. The idea embeddings tick stays on because Idea Space
-- is back in the nav, and the YouTube library tick stays on for Videos.
--
-- No rows in any account are read or changed. Guarded on pg_cron so the local
-- test database, which has none, still resets.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice
      'pg_cron not installed here -- nothing to pause. Expected on the local test database.';
    return;
  end if;

  execute $pause$
    select cron.alter_job(jobid, active := false)
    from cron.job
    where jobname in ('feed-top-up-tick', 'theme-placement-tick', 'topic-import-tick')
  $pause$;
end;
$$;
