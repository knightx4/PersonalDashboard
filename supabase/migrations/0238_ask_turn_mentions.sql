-- Rows the person adds to a question with @ (plan #1899.5).
--
-- A question to Dash can carry the rows the person picked from the search
-- with @: they show on the question, and Dash reads them as the rows it
-- means. They are kept in the turn's citations, the same shape an answer's
-- rows have, so the citations check now takes them on a person's turn too.
-- Tool calls and detail stay Dash's alone.

alter table core.conversation_turns
  drop constraint if exists conversation_turns_citations_ck;

alter table core.conversation_turns
  add constraint conversation_turns_citations_ck
  check (citations is null or jsonb_typeof(citations) = 'array');
