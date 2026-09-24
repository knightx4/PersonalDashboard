-- The Level 3 goal's two counts (plan #906, under #895; decision #905 chose
-- both side by side).
--
-- claimed  Level 3 articles with any evidence at all in article_evidence.
-- tested   Level 3 articles with at least one tested row, a right answer.
-- total    articles on the list, the number both are read against.
--
-- The counts are grouped by article in the database because the view has one
-- row per piece of evidence, and a page reading those rows over the API would
-- stop at the row limit long before a year of cards did. Every kind the view
-- gains later counts towards claimed without this function changing.
--
-- security invoker, so the view is read with the caller's own RLS, and the
-- user filter says the same thing for a caller whose role bypasses it.

set search_path = learn, public, extensions;

create or replace function learn.level3_evidence_counts()
returns table (claimed bigint, tested bigint, total bigint)
language sql
stable
security invoker
set search_path = learn, public, pg_temp
as $$
  select
    (select count(distinct e.article_id)
       from learn.article_evidence e
      where e.user_id = (select auth.uid())) as claimed,
    (select count(distinct e.article_id)
       from learn.article_evidence e
      where e.user_id = (select auth.uid()) and e.kind = 'tested') as tested,
    (select count(*) from learn.area_check_articles) as total;
$$;

comment on function learn.level3_evidence_counts() is
  'The caller''s claimed and tested Level 3 article counts, and the list''s size (plan #906).';

-- Execute is granted to PUBLIC by default, which would include anon.
revoke all on function learn.level3_evidence_counts() from public, anon;
grant execute on function learn.level3_evidence_counts() to authenticated, service_role;
