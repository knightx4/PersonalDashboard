-- The Level 3 articles you claimed but have not been tested on, for Practice
-- Flow (plan #1386, under #1382).
--
-- Practice Flow's goal turns include the Level 3 goal, and its questions are
-- about these articles, so a right answer moves an article from claimed to
-- tested on the Goals page. level3_claimed_articles (0050) returns the same
-- articles, but it takes the person as an argument and is service role only,
-- because Learn now's picking pass runs from Inngest. Practice Flow runs in
-- the person's own session, so this reads the caller's own evidence instead:
-- auth.uid(), and article_evidence read with the caller's RLS.
--
-- An article counts as claimed with any evidence in article_evidence, and as
-- tested with one 'tested' row, the same two rules level3_evidence_counts
-- (0048) applies. The longest claimed first, so the oldest claim is asked
-- about first.

set search_path = learn, public, extensions;

create or replace function learn.level3_untested_claims(p_limit integer default 50)
returns table (id uuid, title text, claimed_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.title, ev.claimed_at
    from (
      select e.article_id,
             min(e.at) as claimed_at,
             bool_or(e.kind = 'tested') as tested
        from learn.article_evidence e
       where e.user_id = (select auth.uid())
       group by e.article_id
    ) ev
    join learn.area_check_articles a on a.id = ev.article_id
   where not ev.tested
   order by ev.claimed_at asc nulls last, a.title
   limit greatest(coalesce(p_limit, 0), 0)
$$;

comment on function learn.level3_untested_claims(integer) is
  'The caller''s claimed, untested Level 3 articles, longest claimed first (plan #1386).';

-- Execute is granted to PUBLIC by default, which would include anon.
revoke all on function learn.level3_untested_claims(integer) from public, anon;
grant execute on function learn.level3_untested_claims(integer) to authenticated, service_role;
