-- An interview has two note fields now, Prep and Notes (plan #1594). The third
-- kind, loose notes written against a round, were rows in job_search.notes
-- with interview_id set. Their text is added to the end of the interview's
-- notes, oldest first, so everything written still shows on the round.
--
-- The rows themselves stay as they are: nothing is removed, and the role page
-- simply stops reading them.

update job_search.interviews i
   set notes = concat_ws(e'\n\n', nullif(btrim(i.notes), ''), c.bodies)
  from (
    select n.interview_id, string_agg(btrim(n.body), e'\n\n' order by n.created_at) as bodies
      from job_search.notes n
     where n.interview_id is not null
       and btrim(n.body) <> ''
     group by n.interview_id
  ) c
 where c.interview_id = i.id;
