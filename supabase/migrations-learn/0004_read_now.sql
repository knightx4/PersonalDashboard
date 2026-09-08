-- The shelf you actually read from.
--
-- A track is a curriculum: ordered, reasoned, and read over weeks. That is the
-- right shape for deciding what to read and the wrong one for the twenty
-- minutes in which you read it, where the question is not "what is the fourth
-- step of my Marx track" but "what did I say I would read next".
--
-- A timestamp rather than a boolean, so the shelf has an order -- what you put
-- there first is what you meant to read first -- and so "when did I shortlist
-- this" is answerable. Null is off the shelf, which is every existing row.
alter table learn.readings add column if not exists read_now_at timestamptz;

-- The whole shelf is the query: a handful of rows out of a queue that grows
-- forever, so the index only carries the ones that are on it.
create index if not exists readings_read_now_idx
  on learn.readings (user_id, read_now_at)
  where read_now_at is not null;

comment on column learn.readings.read_now_at is
  'When this was put on the Read now shelf. Null means it is not on it. '
  'Cleared when the reading is finished or given up on.';
