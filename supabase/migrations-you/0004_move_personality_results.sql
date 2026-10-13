-- Personality results move from Learn to You (plan #1991.2).
--
-- The Big Five results, the types typed in from other tests and Dash's read
-- of each now belong to You's Personality tab. `set schema` moves the table
-- as it is: every row, id, constraint, index, grant, the owner-only policy
-- and the updated_at trigger go with it, so nothing is copied and nothing is
-- lost. The columns are described in migrations-learn/0092 to 0095.
--
-- The trigger keeps calling learn.touch_updated_at(). It is bound to the
-- function itself rather than to its name, so the move does not touch it.
--
-- `if exists` lets a database that has already moved it run this again. On a
-- fresh database migrations-learn runs before this folder, so the table is
-- there to move.

alter table if exists learn.personality_results set schema you;
