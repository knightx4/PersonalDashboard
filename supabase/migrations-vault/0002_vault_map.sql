-- The map of the vault.
--
-- Specified in docs/KNOWLEDGE-SPEC.md. The vault stops being only a viewer and
-- gains a map of itself: what gets written about, what was said about it, and
-- what points at what. Derived from `obsidian.notes` and stored beside them,
-- because the map is the vault's own and nothing else should own it.
--
-- **It makes no claim about what anybody knows, and that is the point.** An
-- earlier draft read the notes for knowledge and landed at a state meaning
-- "your notes say you have this". Every hard problem came out of that: a note a
-- model generated produced 9% of the 75-note trial's nodes as the author's own
-- positions, a copied book chapter would outweigh a dozen idea notes, and
-- coursework needed a routing class to decide whether it counted. All of it
-- dissolves when the map only describes. A copied chapter says its reader was
-- interested in that chapter, which is true and cannot be wrong in a damaging
-- way. What somebody knows lives in `learn`, starts at unknown, and is written
-- only by answering a question. Nothing here writes a knowledge state, and
-- there is deliberately no column in this file that could.
--
-- Two levels, and the difference between them is the design:
--
--   themes     loose labels over a body of writing. No test to pass. These
--              carry interest, and "behavioural economics" is a bad knowledge
--              claim and a fine statement of what somebody reads about.
--   positions  the specific things the notes assert, under those themes. These
--              keep the strict bar, because a position that cannot be argued
--              with is the theme restated.
--
-- Seven tables, and the joins are separate tables rather than columns because
-- membership is non-exclusive in both directions: the ideas worth having are
-- the ones that span themes, and a partition would force exactly those to be
-- duplicated.
--
-- **Nothing here is acyclic.** `learn.concept_edges` rejects a cycle by
-- trigger, because the frontier walks it and a loop is a page that never
-- loads. Nothing walks the edges in this map -- they are read one node at a
-- time, grouped by type -- so the constraint would buy nothing and would
-- refuse honest relations between two notes that answer each other.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- Enums.
-- ---------------------------------------------------------------------------

-- How a position would be probed, if it were ever promoted into a chain.
-- All four were used in the 75-note trial and none collapsed: 47% claim,
-- 37% position, 10% frame, 6% distinction.
create type obsidian.position_kind as enum (
  'claim',        -- something true or false about how the world works
  'position',     -- something that should or should not be done
  'distinction',  -- two things worth telling apart
  'frame'         -- a lens applied to new situations
);

-- Whose thinking this is.
--
-- Not evidence about belief, which is what an earlier draft made it. All three
-- values mean the writer was interested; they differ in how much the writing is
-- their own voice, which is what a reader of the map wants to filter on and
-- what `strength` weighs. `generated` is read from Obsidian's own callout
-- rather than inferred -- one note in this vault opens with "This note was
-- generated and expanded by Claude from a seed idea", and under the old rules
-- every position in it was recorded as the author's own.
create type obsidian.position_stance as enum (
  'held',         -- their own argument, in their own words
  'encountered',  -- somebody else's idea, recorded
  'generated'     -- a model wrote it for them
);

-- The six relations, plus one legacy value.
--
-- The rule for adding a seventh is that some feature has to read it; an edge
-- type with no consumer is decoration. `mentions` is here only to receive the
-- rows `learn.concept_mentions` holds, whose consumer is the "brings up" list
-- already built, and nothing new should be written with it.
--
-- Underscores rather than the hyphens the spec writes, because every other
-- enum in this database is spelled that way.
create type obsidian.edge_type as enum (
  'requires',     -- you cannot understand B at all without A. Rare by design
  'supports',     -- B is true partly because A is
  'qualifies',    -- A bounds or conditions B
  'contradicts',  -- these two cannot both stand
  'example_of',   -- a concrete case of something more abstract
  'same_as',      -- one idea under two names
  'mentions'      -- legacy. Closed to new writes
);

-- What a disagreement between two positions actually is.
--
-- Only two of the six are real contradictions. The rest are clarifications and
-- worth as much: scope and level are where an amateur take usually falls apart.
create type obsidian.tension_kind as enum (
  'scope',         -- both true under different conditions
  'level',         -- true at different levels
  'changed_mind',  -- a fact about the writer rather than the world
  'live_dispute',  -- the field itself disagrees
  'inconsistent',  -- they hold two things that cannot both stand
  'wrong'          -- one is simply wrong
);

-- Where a disagreement stands. A dismissal is permanent: a tension already
-- waved away coming back is the fastest way to make the feature look stupid.
create type obsidian.tension_status as enum (
  'open',
  'resolved',
  'live_dispute',
  'superseded',
  'dismissed'
);

-- ---------------------------------------------------------------------------
-- A note has to be addressable by (id, user_id) before anything here can point
-- at it with a composite key. `id` is already the primary key, so this
-- constraint adds no new guarantee -- it exists so the foreign keys below can
-- carry `user_id` and make a cross-account link impossible rather than merely
-- unlikely. Foreign keys are not subject to RLS, which is the whole reason.
-- ---------------------------------------------------------------------------
alter table obsidian.notes
  add constraint notes_id_user_key unique (id, user_id);

-- ---------------------------------------------------------------------------
-- Themes: what gets written about.
-- ---------------------------------------------------------------------------
create table obsidian.themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  -- One line on what this covers, in the writer's terms. Not optional: an
  -- unexplained label is one nobody can argue with, which is the same
  -- discipline `locator_basis` holds the reading side to.
  about text not null,

  -- How much of the vault is about this. An interest measure and never a
  -- knowledge measure: notes touching it, text, recency, and the stance mix.
  -- Recomputed by a pass, never written by hand, and 0 until one has run.
  strength numeric not null default 0,

  -- From the notes' own dates, so an interest that cooled looks cool. Null
  -- while the notes under it carry no date, which is most of them until a
  -- later commit touches the path.
  first_seen timestamptz,
  last_seen timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint themes_name_ck check (name <> ''),
  constraint themes_about_ck check (about <> ''),
  constraint themes_strength_ck check (strength >= 0)
);

-- One theme per name per person. Case-insensitive, because "Urbanism" and
-- "urbanism" are the merge pass failing rather than two themes.
create unique index themes_user_name_key on obsidian.themes (user_id, lower(name));
create index themes_user_strength_idx on obsidian.themes (user_id, strength desc);
-- The merge pass blocks on trigram similarity before it asks a model anything,
-- which is what removes ~99% of the comparison space at no token cost.
create index themes_name_trgm_idx on obsidian.themes using gin (name extensions.gin_trgm_ops);
alter table obsidian.themes add constraint themes_id_user_key unique (id, user_id);

-- ---------------------------------------------------------------------------
-- Which notes a theme covers.
--
-- Separate from the positions under it, because a note can put a theme on the
-- map while asserting nothing. A transcript is the clearest case: strong
-- evidence of what somebody studied, and no arguable position anywhere in it.
-- Deriving theme coverage from positions alone would lose exactly those.
-- ---------------------------------------------------------------------------
create table obsidian.theme_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null,
  note_id uuid not null,

  -- Why this note counts toward this theme, in a sentence.
  basis text not null,

  created_at timestamptz not null default now(),

  constraint theme_notes_basis_ck check (basis <> ''),
  constraint theme_notes_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id) on delete cascade,
  constraint theme_notes_note_fk
    foreign key (note_id, user_id) references obsidian.notes (id, user_id) on delete cascade,
  constraint theme_notes_pair_uq unique (theme_id, note_id)
);

create index theme_notes_note_idx on obsidian.theme_notes (note_id);
create index theme_notes_theme_idx on obsidian.theme_notes (theme_id);

-- ---------------------------------------------------------------------------
-- Positions: the specific things the notes assert.
--
-- The strict bar lives here and nowhere else. Two tests, both of which have to
-- pass: could you write a question that somebody who holds this answers
-- differently, and would being wrong about it cost you anything. The second
-- was added after the 30-note trial -- "NPV quantifies, IRR is comparable"
-- passes the first and nobody would argue it, and a bar that admits facts
-- about tools admits thousands of them.
-- ---------------------------------------------------------------------------
create table obsidian.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  -- The position itself, in one or two sentences. Generated first and
  -- overwritable; an edited statement is what later work is written against.
  statement text not null,
  -- How the map knows this, in a sentence. Rendered, not hidden.
  basis text not null,

  kind obsidian.position_kind not null,
  stance obsidian.position_stance not null,

  -- How much else points at this, weighted so `requires` counts most and
  -- `contradicts` not at all. Needs no model call, is stable when the map
  -- grows, and is what a zoomed-out view is ordered by.
  centrality numeric not null default 0,

  -- Set when every quote supporting this has left the record -- a note was
  -- rewritten, a paragraph cut. Not a delete, because the writer may well
  -- still hold the position; the map just can no longer show where it came
  -- from. The same instinct as the soft delete on notes: this app must never
  -- be the reason something is gone.
  ungrounded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint positions_name_ck check (name <> ''),
  constraint positions_statement_ck check (statement <> ''),
  constraint positions_basis_ck check (basis <> ''),
  constraint positions_centrality_ck check (centrality >= 0)
);

alter table obsidian.positions add constraint positions_id_user_key unique (id, user_id);
create index positions_user_centrality_idx on obsidian.positions (user_id, centrality desc)
  where ungrounded_at is null;
create index positions_user_kind_idx on obsidian.positions (user_id, kind);
-- Blocking for the merge pass, over the statement rather than the name,
-- because two notes state the same position under quite different labels.
create index positions_statement_trgm_idx
  on obsidian.positions using gin (statement extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Which positions sit under which theme.
--
-- Not a column on `positions`, because the positions worth having are the ones
-- that span themes. The right-size argument in this vault is stated once about
-- neighbourhoods and once about online groups, in two notes that never cite
-- each other, and a single theme column would force a choice between them.
-- ---------------------------------------------------------------------------
create table obsidian.theme_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null,
  position_id uuid not null,

  basis text not null,

  created_at timestamptz not null default now(),

  constraint theme_positions_basis_ck check (basis <> ''),
  constraint theme_positions_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id) on delete cascade,
  constraint theme_positions_position_fk
    foreign key (position_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  constraint theme_positions_pair_uq unique (theme_id, position_id)
);

create index theme_positions_theme_idx on obsidian.theme_positions (theme_id);
create index theme_positions_position_idx on obsidian.theme_positions (position_id);

-- ---------------------------------------------------------------------------
-- Provenance: where a position came from, and the sentence that says so.
--
-- This is the table that makes the map checkable and the sweep re-runnable,
-- and it replaces what an earlier draft kept as a prose sentence.
--
-- `quote` must appear verbatim in the note's body or the candidate is refused
-- before it is ever written. That is the locate pass's rule moved one module
-- over, and the same argument: a model returning a quote that is not in the
-- text has invented it, and a string search catches that for free. The 75-note
-- trial verified 163 of 163, including one carrying the typo `aparments`.
--
-- `blob_sha` is git's own hash of the note as it was when read. An unchanged
-- note is not re-read; a changed one is re-extracted and compared rather than
-- duplicated. Without it the sweep has no way to be run twice.
-- ---------------------------------------------------------------------------
create table obsidian.position_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid not null,
  note_id uuid not null,

  -- Verbatim, and checked against the body before this row is written.
  quote text not null,
  -- What the note was when the quote was taken.
  blob_sha text not null,

  created_at timestamptz not null default now(),

  constraint position_sources_quote_ck check (quote <> ''),
  constraint position_sources_blob_ck check (blob_sha <> ''),
  constraint position_sources_position_fk
    foreign key (position_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  constraint position_sources_note_fk
    foreign key (note_id, user_id) references obsidian.notes (id, user_id) on delete cascade,
  -- One row per position per quote. The same position supported twice from one
  -- note is two sentences, and both are worth keeping.
  constraint position_sources_quote_uq unique (position_id, note_id, quote)
);

create index position_sources_position_idx on obsidian.position_sources (position_id);
-- "What did this note produce", which is the review queue's main read.
create index position_sources_note_idx on obsidian.position_sources (note_id);

-- ---------------------------------------------------------------------------
-- Edges between positions.
--
-- Six types for anything newly written, each with an optional line saying what
-- the relation actually is. The type is closed and the description is not, so a
-- relation that does not fit is degraded rather than lost -- and after a few
-- hundred edges the descriptions on awkwardly typed edges are the evidence for
-- whether a seventh type is needed, instead of the question being guessed at
-- now.
--
-- The 75-note trial's spread: supports 57%, qualifies 24%, example_of 13%,
-- requires 6%, contradicts 1%. `requires` coming out rarest is what the design
-- wants. `same_as` never fired because extraction only proposes edges inside
-- one note; it is a merge-time relation.
-- ---------------------------------------------------------------------------
create table obsidian.position_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  from_id uuid not null,
  to_id uuid not null,
  type obsidian.edge_type not null,

  -- One line on what this relation is. Optional, unlike a theme's `about`: the
  -- type already carries the claim, and a forced description is one somebody
  -- writes to get past the check.
  description text,

  created_at timestamptz not null default now(),

  constraint position_edges_not_self_ck check (from_id <> to_id),
  constraint position_edges_description_ck check (description is null or description <> ''),
  constraint position_edges_from_fk
    foreign key (from_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  constraint position_edges_to_fk
    foreign key (to_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  -- One edge per pair per type. Two positions can both support and qualify
  -- each other, and a repeat of the same type says nothing new.
  constraint position_edges_triple_uq unique (from_id, to_id, type)
);

create index position_edges_from_idx on obsidian.position_edges (from_id);
create index position_edges_to_idx on obsidian.position_edges (to_id);
create index position_edges_user_type_idx on obsidian.position_edges (user_id, type);

-- ---------------------------------------------------------------------------
-- Tensions: two positions that cannot both stand.
--
-- The app never resolves one. It shows both, where each came from, which of the
-- six kinds it looks like, and a proposed crux, and the person decides. The
-- resolution is a new position joined to both originals by `qualifies`, which
-- is the reason that edge type exists.
--
-- A tension demotes nothing, because nothing in this map was ever promoted.
-- That was a knowledge-state consequence and it is gone with the states.
-- ---------------------------------------------------------------------------
create table obsidian.tensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  left_id uuid not null,
  right_id uuid not null,

  kind obsidian.tension_kind not null,
  status obsidian.tension_status not null default 'open',

  -- One sentence naming what the disagreement turns on. Proposed, and the most
  -- useful thing on the card.
  crux text not null,
  -- Filled when the person settles it. The position that holds the condition
  -- or distinction separating the two, when one was written.
  resolution_id uuid,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tensions_not_self_ck check (left_id <> right_id),
  constraint tensions_crux_ck check (crux <> ''),
  -- Settled means settled: a status past `open` carries its date, and `open`
  -- carries neither a date nor a resolution.
  constraint tensions_resolved_ck check (
    (status = 'open' and resolved_at is null and resolution_id is null)
    or (status <> 'open' and resolved_at is not null)
  ),
  constraint tensions_left_fk
    foreign key (left_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  constraint tensions_right_fk
    foreign key (right_id, user_id) references obsidian.positions (id, user_id) on delete cascade,
  constraint tensions_resolution_fk
    foreign key (resolution_id, user_id) references obsidian.positions (id, user_id) on delete set null (resolution_id),
  -- One row per pair. Which of the two is `left` is an accident of how they
  -- were found, so the pair is ordered before it is written -- see the trigger.
  constraint tensions_pair_uq unique (left_id, right_id)
);

create index tensions_user_status_idx on obsidian.tensions (user_id, status);
create index tensions_left_idx on obsidian.tensions (left_id);
create index tensions_right_idx on obsidian.tensions (right_id);
create index tensions_resolution_idx on obsidian.tensions (resolution_id)
  where resolution_id is not null;

-- A tension between A and B is the same tension as between B and A, and the
-- unique constraint above cannot see that on its own. Ordering the pair by id
-- before the row is written makes the constraint mean what it says, so a
-- dismissed tension cannot come back by being found from the other side.
create or replace function obsidian.tension_pair_is_ordered()
returns trigger
language plpgsql
as $$
declare
  swap uuid;
begin
  if new.left_id > new.right_id then
    swap := new.left_id;
    new.left_id := new.right_id;
    new.right_id := swap;
  end if;
  return new;
end;
$$;

alter function obsidian.tension_pair_is_ordered() set search_path = obsidian;

create trigger tensions_pair_is_ordered
  before insert or update of left_id, right_id on obsidian.tensions
  for each row execute function obsidian.tension_pair_is_ordered();

revoke all on function obsidian.tension_pair_is_ordered() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- updated_at, on the three tables that are edited rather than replaced.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['themes', 'positions', 'tensions'] loop
    execute format(
      'create trigger %I before update on obsidian.%I
         for each row execute function obsidian.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Every table, in the migration that creates it, before any feature code
-- reads or writes one of them. Build step 2's rule for the sixth time and the
-- same reason: a table that arrives without a policy has to fail immediately.
--
-- Themes, positions and tensions are edited -- a generated statement is meant
-- to be overwritten, a tension is meant to be settled -- so they get all four.
-- The joins and the provenance rows are the pair or the quote they name;
-- changing either end is a different row, which is a delete and an insert, so
-- they get no update policy at all.
-- ---------------------------------------------------------------------------
alter table obsidian.themes enable row level security;
alter table obsidian.theme_notes enable row level security;
alter table obsidian.positions enable row level security;
alter table obsidian.theme_positions enable row level security;
alter table obsidian.position_sources enable row level security;
alter table obsidian.position_edges enable row level security;
alter table obsidian.tensions enable row level security;

create policy themes_all on obsidian.themes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy positions_all on obsidian.positions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy tensions_all on obsidian.tensions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['theme_notes', 'theme_positions', 'position_sources', 'position_edges'] loop
    execute format(
      'create policy %I on obsidian.%I for select to authenticated
         using (user_id = (select auth.uid()))', t || '_select', t);
    execute format(
      'create policy %I on obsidian.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format(
      'create policy %I on obsidian.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t || '_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Explicit per table. The `all tables in schema` grant at the end of 0001 ran
-- once against the tables that existed then; it does not reach forward, and a
-- table created later with no grant is one every read fails on.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  obsidian.themes, obsidian.positions, obsidian.tensions
  to authenticated, service_role;

grant select, insert, delete on
  obsidian.theme_notes, obsidian.theme_positions,
  obsidian.position_sources, obsidian.position_edges
  to authenticated, service_role;

-- Nothing here is readable by an anonymous visitor. Same reach-forward problem
-- as the grants, so it is repeated rather than assumed.
revoke all on
  obsidian.themes, obsidian.theme_notes, obsidian.positions,
  obsidian.theme_positions, obsidian.position_sources,
  obsidian.position_edges, obsidian.tensions
  from anon;
