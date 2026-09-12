-- A track that came out of a broader one.
--
-- "Economics" is not a route, it is a shelf. The planner says so and refuses
-- it, and what happens next is that the areas inside it are named and the ones
-- you keep become tracks of their own -- "how prices get set", "what a central
-- bank does" -- each planned separately when you open it. This column is the
-- only thing that remembers they came from economics.
--
-- A track of its own rather than a row inside the broad one, which was decided
-- rather than assumed: each kept area gets its own queue, its own progress and
-- its own Plan this topic button, and none of those had to be built twice.
-- Going deeper on a single step of a route later lands in the same shape.
--
-- Nullable, and most tracks will stay null: a topic you typed came from
-- nowhere in particular.

alter table learn.tracks
  add column if not exists branched_from uuid;

-- Ownership by the key, the same way readings point at their two parents. The
-- pair (branched_from, user_id) points at tracks (id, user_id), so a track
-- cannot be hung under another account's track -- referential integrity
-- bypasses RLS, and carrying user_id in the key is what makes that impossible
-- rather than unlikely. MATCH SIMPLE, the default, skips the check for a row
-- with a null branched_from, which is every track you started yourself.
--
-- `set null (branched_from)` names the column: deleting the broad topic frees
-- the areas rather than taking them with it. A bare `set null` would try to
-- null user_id too and fail, and a cascade would delete tracks you have been
-- reading for weeks because the shelf they came off was tidied away. It also
-- keeps the delete prompt on a track page honest, which says the readings go
-- and nothing else.
alter table learn.tracks
  add constraint tracks_branched_from_fk
  foreign key (branched_from, user_id) references learn.tracks (id, user_id)
  on delete set null (branched_from);

-- A track cannot come out of itself. The foreign key is satisfied by its own
-- row, so this has to be said separately.
alter table learn.tracks
  add constraint tracks_branched_from_self_ck
  check (branched_from is null or branched_from <> id);

-- What came out of this topic, for the list page drawing children under their
-- parent. Only the branched rows are in it; the ones you started yourself are
-- the majority and are never looked up this way.
create index if not exists tracks_branched_from_idx
  on learn.tracks (branched_from)
  where branched_from is not null;

comment on column learn.tracks.branched_from is
  'The broader track this one was branched out of, when it came from keeping '
  'an area of a topic too broad to plan. Null for a track you started '
  'yourself. What lets the list page show it under the topic it came from.';
