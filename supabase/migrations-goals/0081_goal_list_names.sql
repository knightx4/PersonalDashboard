-- ===========================================================================
-- A goal list's name is unique among its goal's lists (plan #2330.2).
--
-- 0009 made a collection's name unique across the account, so "loans" means
-- one thing. A goal's own list (0080) is named for what it holds on that
-- goal, and two goals can each keep a list called "Candidates". So the name
-- of a collection with no goal stays unique across the account, and a list's
-- name is unique among the live lists of its goal.
--
-- Kept apart from 0080 because the connector waits on a confirmation for the
-- statement that takes the old index away; the workflow on main applies it.
-- ===========================================================================

drop index goals.collections_user_name_key;

create unique index collections_user_name_key on goals.collections (user_id, lower(btrim(name)))
  where archived_at is null and goal_id is null;

create unique index collections_goal_name_key on goals.collections (goal_id, lower(btrim(name)))
  where archived_at is null and goal_id is not null;
