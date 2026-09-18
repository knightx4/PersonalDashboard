-- The second half of the learn module: a graph of what you know.
--
-- Specified in docs/LEARN-GRAPH-SPEC.md. The first half answers "where do I
-- read this"; this answers "what do I actually know, what am I missing, and
-- what is the one next thing worth learning". The store that makes that
-- answerable is concepts with prerequisites, plus a record of what you have
-- been tested on and how it went.
--
-- Three properties are made database facts here rather than left to the
-- application, on the same instinct that made `locator_basis` not null in
-- 0001: the module is allowed to infer things and is not allowed to infer them
-- quietly.
--
--   **A node is a claim, not a heading.** `claim` is not null and non-empty.
--   A heading cannot be probed and cannot be wrong, and a graph of headings is
--   a syllabus. "Inflation and unemployment trade off in the short run because
--   wage expectations adjust more slowly than prices" is a node; "The Phillips
--   curve" is a chapter title.
--
--   **Nothing is added without an edge.** Enforced in the application rather
--   than here, because a node and its first edge cannot be written in the same
--   statement, but the shape of the tables is what makes it checkable.
--
--   **Cycles are rejected by the database.** An edge whose dependent already
--   reaches its prerequisite fails the insert. The acyclic property is what
--   every view rule below depends on, and a property the application merely
--   promises is a property you find out about from a page that never loads.
--
-- Prior learning -- transcripts, syllabi, degrees -- is explicitly not here.
-- The spec's open questions name this graph as the store it will eventually
-- land in; nothing in this migration prejudges its shape.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Enums.
-- ---------------------------------------------------------------------------

-- What is true about you and one concept.
--
-- `misconception` is deliberately not a worse `unknown`. Not knowing is a gap
-- and reading fixes it; a misconception is something actively steering you
-- wrong, which you will not find by reading more of the same. They are
-- different problems and they get different rows on a screen.
-- Named for the state rather than for the table, because a table creates a
-- type of its own name and `learn.concept_state` is the table below.
create type learn.knowledge_state as enum (
  'unknown',
  'shaky',
  'known',
  'misconception'
);

-- How that state came to be believed.
--
-- Separate from the state itself because "you answered three questions on it"
-- and "you told me you knew it" and "something above it was answered so this
-- must be known" are three different strengths of claim, and a screen that
-- renders them identically is overstating two of them.
create type learn.state_basis as enum (
  'tested',    -- probed, and the answers say so
  'inferred',  -- something above it was answered correctly
  'declared'   -- you said so
);

-- Where a concept came from. The node-level version of `locator_basis`.
create type learn.concept_origin as enum (
  'generated',  -- proposed for a goal by a model, and approved
  'probe',      -- a probe found a floor that was missing
  'reading',    -- extracted from a note you wrote after reading
  'manual'      -- you wrote it down
);

-- Where a goal stands.
create type learn.goal_status as enum (
  'proposed',   -- generated, waiting for you to approve the chain
  'active',
  'reached',
  'abandoned'
);

-- ---------------------------------------------------------------------------
-- Subjects: the container.
--
-- One graph per subject, and it lives forever. The hard constraint in the spec
-- is on the subject rather than on the goal: `Economics` works, `Science` does
-- not, because the concepts of science have no prerequisite relationships with
-- each other and a graph with no edges makes every rule below do nothing. The
-- test is whether one survey course could plausibly cover it. That judgement
-- is not enforceable in SQL and is not attempted here.
-- ---------------------------------------------------------------------------
create table learn.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  -- Why you started it, in your words. Optional, and useful six months later.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subjects_name_ck check (name <> '')
);

-- One `Economics` per account. Two half-graphs of the same subject is the
-- failure the spec warns about, and case-insensitive is the version of the
-- rule that actually holds -- `economics` and `Economics` are one subject.
create unique index subjects_user_name_uq on learn.subjects (user_id, lower(name));

-- The composite key every child points at, so a link across accounts is
-- impossible rather than merely unlikely. Referential integrity bypasses RLS,
-- which is why todo.task_links needed a trigger; carrying user_id in the key
-- gets the same guarantee from the constraint itself.
alter table learn.subjects add constraint subjects_user_id_uq unique (id, user_id);

create index subjects_user_idx on learn.subjects (user_id, name);

-- ---------------------------------------------------------------------------
-- Concepts: one claim you can be right or wrong about.
-- ---------------------------------------------------------------------------
create table learn.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  -- Short, for the graph view. "Wage stickiness".
  name text not null,
  -- One or two sentences, and the thing a probe question is written against.
  -- A node whose claim cannot be stated is a heading, and headings do not go
  -- in this table.
  claim text not null,
  -- How this node came to be believed to belong here, in a sentence. The same
  -- discipline as locator_basis: "standard in any intermediate macro sequence"
  -- and "inferred from the goal, not checked against a syllabus" are different
  -- claims and the difference is shown.
  basis text not null,
  origin learn.concept_origin not null default 'manual',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint concepts_name_ck check (name <> ''),
  constraint concepts_claim_ck check (claim <> ''),
  constraint concepts_basis_ck check (basis <> ''),
  constraint concepts_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade
);

alter table learn.concepts add constraint concepts_user_id_uq unique (id, user_id);
-- Also unique by subject, so an edge can require both of its ends to be in the
-- same subject through the foreign key rather than through a second check.
alter table learn.concepts add constraint concepts_subject_id_uq unique (id, subject_id);

create index concepts_subject_idx on learn.concepts (subject_id, name);

-- ---------------------------------------------------------------------------
-- Edges: prerequisite → dependent, inside one subject, acyclic.
-- ---------------------------------------------------------------------------
create table learn.concept_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  prerequisite_id uuid not null,
  dependent_id uuid not null,

  -- Why this is a prerequisite, in a sentence. An edge is as much of a claim
  -- as a node is, and an unexplained one is what makes a generated graph
  -- impossible to argue with.
  basis text not null,

  created_at timestamptz not null default now(),

  constraint concept_edges_basis_ck check (basis <> ''),
  -- The cheap half of acyclicity. The expensive half is the trigger below.
  constraint concept_edges_not_self_ck check (prerequisite_id <> dependent_id),
  -- One edge per pair. A second one says nothing new and would make the walk
  -- below do the same work twice.
  constraint concept_edges_pair_uq unique (prerequisite_id, dependent_id),

  constraint concept_edges_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  -- Both ends in this subject, by the key rather than by a check: an edge
  -- across two subjects would make "one graph per subject" false quietly.
  constraint concept_edges_prerequisite_fk
    foreign key (prerequisite_id, subject_id) references learn.concepts (id, subject_id) on delete cascade,
  constraint concept_edges_dependent_fk
    foreign key (dependent_id, subject_id) references learn.concepts (id, subject_id) on delete cascade
);

create index concept_edges_dependent_idx on learn.concept_edges (dependent_id);
create index concept_edges_prerequisite_idx on learn.concept_edges (prerequisite_id);
create index concept_edges_subject_idx on learn.concept_edges (subject_id);

-- ---------------------------------------------------------------------------
-- Goals: what you actually typed.
--
-- A goal is a node in a subject's graph plus the chain leading to it. Naming
-- the Phillips curve does not build a Phillips-curve graph -- it works out
-- that this is economics and builds the chain to that node inside your one
-- economics graph.
-- ---------------------------------------------------------------------------
create table learn.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  -- Your words, kept. "keynesian economics" stays what you asked for even
  -- after it resolves to a node called something tidier.
  asked text not null,
  -- The node it resolved to. Null while a goal is still being worked out.
  concept_id uuid,

  status learn.goal_status not null default 'proposed',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reached_at timestamptz,

  constraint goals_asked_ck check (asked <> ''),
  constraint goals_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint goals_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete set null
);

create index goals_subject_idx on learn.goals (subject_id, status);

-- ---------------------------------------------------------------------------
-- State: one row per concept, what is true about you and it.
-- ---------------------------------------------------------------------------
create table learn.concept_state (
  concept_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,

  state learn.knowledge_state not null default 'unknown',
  established learn.state_basis not null default 'inferred',

  -- The misconception itself, named, when there is one. The most valuable
  -- thing this system produces: a gap and a thing steering you wrong are
  -- different problems, and only one of them is fixed by reading more.
  misconception text,

  -- When it was last actually probed, not when the row was touched. "Not
  -- checked since March" is the honest thing to show; decaying the state on a
  -- timer would be a bar that falls while you do nothing, which the reading
  -- side already refused once.
  tested_at timestamptz,
  updated_at timestamptz not null default now(),

  -- A named misconception is a claim about a specific wrong idea, so it only
  -- means anything in that state, and that state means nothing without it.
  constraint concept_state_misconception_ck check (
    (state = 'misconception') = (misconception is not null and misconception <> '')
  ),
  -- Tested is a claim about work that was done.
  constraint concept_state_tested_ck check (established <> 'tested' or tested_at is not null),
  constraint concept_state_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade
);

create index concept_state_user_state_idx on learn.concept_state (user_id, state);

-- ---------------------------------------------------------------------------
-- Probes: every question asked, kept in full.
--
-- Not collapsed into a score. This is what makes "you have been wrong about
-- this three times in four months" answerable, and it is what any future
-- re-probing schedule reads. It is also the evidence for a named
-- misconception, which is otherwise an assertion nobody can check.
-- ---------------------------------------------------------------------------
create table learn.probes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid not null,

  question text not null,
  -- The options as asked, in order. Kept verbatim, because a stored index
  -- means nothing a month later if the options were regenerated.
  options jsonb not null,
  correct_index int not null,
  -- Written at the same time as the question and stored, then shown after you
  -- answer. If it cannot be written without appealing back to the question,
  -- the question was thrown away before it got here -- that check is the
  -- cheapest verification available and it catches most bad items.
  reason text not null,

  -- Null until answered.
  chosen_index int,
  answered_at timestamptz,

  -- What this told us, on the spec's scale: 1.0 settled something unknown,
  -- 0.3 reinforced something settled, 0 inconclusive. Stored rather than
  -- recomputed, because it is a fact about the moment it was earned.
  weight numeric(3, 2) not null default 0,

  model text,
  created_at timestamptz not null default now(),

  constraint probes_question_ck check (question <> ''),
  constraint probes_reason_ck check (reason <> ''),
  constraint probes_options_ck check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  constraint probes_correct_ck check (correct_index >= 0 and correct_index < jsonb_array_length(options)),
  constraint probes_chosen_ck check (
    chosen_index is null or (chosen_index >= 0 and chosen_index < jsonb_array_length(options))
  ),
  -- Answered is a fact with two halves; half of it is a row nobody can read.
  constraint probes_answered_ck check ((chosen_index is null) = (answered_at is null)),
  constraint probes_weight_ck check (weight >= 0 and weight <= 1),
  constraint probes_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade
);

create index probes_concept_idx on learn.probes (concept_id, created_at desc);
create index probes_user_answered_idx on learn.probes (user_id, answered_at desc);

-- ---------------------------------------------------------------------------
-- The cycle check.
--
-- An edge is refused if its dependent already reaches its prerequisite, which
-- is exactly the condition under which adding it would close a loop. Written
-- as a recursive walk from the dependent forwards: if the prerequisite turns
-- up among the things that already depend on it, the graph would eat itself.
--
-- In the database rather than in the application because everything that
-- reads this graph -- the pruning rule, the reading order, the "what is the
-- next thing worth learning" question -- assumes termination. A cycle would
-- not show up as a wrong answer; it would show up as a page that never loads,
-- weeks after whatever wrote it.
--
-- Cost is a walk of one subject's edges on each insert, which is a graph of
-- hundreds. The alternative -- a materialised closure -- costs a write
-- amplification on every edge to save microseconds on an operation that
-- happens a few dozen times a session.
-- ---------------------------------------------------------------------------
create or replace function learn.reject_edge_cycle()
returns trigger
language plpgsql
as $$
begin
  if exists (
    with recursive reachable as (
      select e.dependent_id as id
        from learn.concept_edges e
       where e.prerequisite_id = new.dependent_id
      union
      select e.dependent_id
        from learn.concept_edges e
        join reachable r on e.prerequisite_id = r.id
    )
    select 1 from reachable where id = new.prerequisite_id
  ) then
    raise exception
      'concept_edges: % -> % would close a cycle',
      new.prerequisite_id, new.dependent_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

alter function learn.reject_edge_cycle() set search_path = learn;
revoke all on function learn.reject_edge_cycle() from public, anon, authenticated;

create trigger concept_edges_reject_cycle
  before insert or update of prerequisite_id, dependent_id
  on learn.concept_edges
  for each row execute function learn.reject_edge_cycle();

-- ---------------------------------------------------------------------------
-- updated_at, on the tables that have it.
-- ---------------------------------------------------------------------------
create trigger subjects_touch_updated_at
  before update on learn.subjects
  for each row execute function learn.touch_updated_at();

create trigger concepts_touch_updated_at
  before update on learn.concepts
  for each row execute function learn.touch_updated_at();

create trigger goals_touch_updated_at
  before update on learn.goals
  for each row execute function learn.touch_updated_at();

create trigger concept_state_touch_updated_at
  before update on learn.concept_state
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. Yours and only yours, as everywhere else.
-- ---------------------------------------------------------------------------
alter table learn.subjects enable row level security;
alter table learn.concepts enable row level security;
alter table learn.concept_edges enable row level security;
alter table learn.goals enable row level security;
alter table learn.concept_state enable row level security;
alter table learn.probes enable row level security;

create policy subjects_all on learn.subjects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy concepts_all on learn.concepts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy concept_edges_all on learn.concept_edges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy goals_all on learn.goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy concept_state_all on learn.concept_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy probes_all on learn.probes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.subjects, learn.concepts, learn.concept_edges,
  learn.goals, learn.concept_state, learn.probes from anon;

grant select, insert, update, delete on learn.subjects, learn.concepts,
  learn.concept_edges, learn.goals, learn.concept_state, learn.probes
  to authenticated, service_role;
