-- Topics with ten levels (docs/LEARN-LEVELS-SPEC.md, slice 1; plan #2138.1).
--
-- The eight tables in the spec's "Tables" section. A topic is something the
-- person would name when saying what they know; it has one cell per level up
-- to its ceiling, and cells of different topics are tied by requirement
-- links. Evidence is written per cell. Statuses, levels, the fringe and lens
-- progress are computed on read by lib/learn/levels/model.ts and never stored
-- (rule R4).
--
--   topics         name, scope, ceiling, fields, scope embedding, draft or approved
--   topic_cells    one per topic and level: the descriptor's checks
--   cell_links     requiring cell -> required cell, the sentence why, acyclic
--   cell_claims    concepts and vault positions that are material for a cell
--   cell_evidence  met, not met or declared, with the probe and the quote
--   lenses         a named set of targets, from a subject or a goal
--   lens_targets   lens, topic, target level
--   link_reviews   a link in doubt, the two answers behind it, the decision
--
-- Every child carries user_id in its foreign keys, so a row can only point at
-- rows of the same account, as in 0005.
--
-- The cycle check counts the in-topic chain, which is never stored: every
-- level requires the one below it. So a link from A 1 to B 5 and one from
-- B 2 to A 3 make a cycle (A 3 needs A 1, A 1 needs B 5, B 5 needs B 2, B 2
-- needs A 3), and the second is refused. A cell's topic and level cannot be
-- changed after it is written, because moving a cell could close a cycle
-- that no link insert would see.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Topics.
-- ---------------------------------------------------------------------------
create table learn.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  -- One sentence: what it covers and what it leaves to its neighbours.
  -- Deduplication matches on this.
  scope text not null,
  -- The highest level with real content for this topic. Cells above it do
  -- not exist, and the model ignores any that do.
  ceiling smallint not null default 10,
  -- Fields from LEARN-AREAS-SPEC (learn.area_fields ids), as tags.
  field_ids uuid[] not null default '{}',

  -- Nothing is asked about a draft.
  status text not null default 'draft',
  approved_at timestamptz,

  -- The scope, embedded for deduplication. Cleared when the scope changes.
  scope_embedding vector(1024),
  embedding_model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint topics_name_ck check (name <> ''),
  constraint topics_scope_ck check (scope <> ''),
  constraint topics_ceiling_ck check (ceiling between 1 and 10),
  constraint topics_status_ck check (status in ('draft', 'approved')),
  constraint topics_approved_ck check ((status = 'approved') = (approved_at is not null)),
  constraint topics_user_id_uq unique (id, user_id)
);

create index if not exists topics_user_name_idx on learn.topics (user_id, lower(name));

create or replace function learn.topics_clear_embedding()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
begin
  if new.scope is distinct from old.scope then
    new.scope_embedding := null;
    new.embedding_model := null;
  end if;
  return new;
end;
$$;

revoke all on function learn.topics_clear_embedding() from public, anon, authenticated;

create trigger topics_clear_embedding_trg
  before update of scope on learn.topics
  for each row execute function learn.topics_clear_embedding();

create trigger topics_touch_updated_at
  before update on learn.topics
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cells: one level of one topic.
-- ---------------------------------------------------------------------------
create table learn.topic_cells (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic_id uuid not null,
  level smallint not null,

  -- Two to four observable checks saying what meeting this level looks like.
  descriptor text[] not null,
  -- The drafted checks, kept the first time the person rewrites them. Null
  -- while the wording is the draft's.
  descriptor_original text[],
  -- When the checks were last rewritten by hand.
  rewritten_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint topic_cells_level_ck check (level between 1 and 10),
  constraint topic_cells_descriptor_ck check (
    cardinality(descriptor) between 2 and 4 and array_position(descriptor, '') is null
  ),
  constraint topic_cells_topic_level_uq unique (topic_id, level),
  constraint topic_cells_user_id_uq unique (id, user_id),
  constraint topic_cells_topic_fk
    foreign key (topic_id, user_id) references learn.topics (id, user_id) on delete cascade
);

create or replace function learn.topic_cells_fixed()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
begin
  if new.topic_id is distinct from old.topic_id or new.level is distinct from old.level then
    raise exception 'topic_cells: a cell keeps its topic and level; write a new cell instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function learn.topic_cells_fixed() from public, anon, authenticated;

create trigger topic_cells_fixed_trg
  before update of topic_id, level on learn.topic_cells
  for each row execute function learn.topic_cells_fixed();

create trigger topic_cells_touch_updated_at
  before update on learn.topic_cells
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Requirement links between cells of different topics.
--
-- A link names the lowest level the requiring cell needs, and holds for every
-- higher cell of the requiring topic through the in-topic chain.
-- ---------------------------------------------------------------------------
create table learn.cell_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  requiring_cell_id uuid not null,
  required_cell_id uuid not null,
  -- Why, in a sentence, drafted with the topic. Optional.
  why text,

  created_at timestamptz not null default now(),

  constraint cell_links_not_self_ck check (requiring_cell_id <> required_cell_id),
  constraint cell_links_why_ck check (why is null or why <> ''),
  constraint cell_links_pair_uq unique (requiring_cell_id, required_cell_id),
  constraint cell_links_user_id_uq unique (id, user_id),
  constraint cell_links_requiring_fk
    foreign key (requiring_cell_id, user_id) references learn.topic_cells (id, user_id) on delete cascade,
  constraint cell_links_required_fk
    foreign key (required_cell_id, user_id) references learn.topic_cells (id, user_id) on delete cascade
);

create index if not exists cell_links_required_idx on learn.cell_links (required_cell_id);
create index if not exists cell_links_user_idx on learn.cell_links (user_id);

-- Refuses a link within one topic (the chain covers it) and a link that would
-- close a cycle. The walk starts at the required cell and reaches, for each
-- topic, the highest level that cell needs: everything at or below a reached
-- level is reached through the chain, and its links are followed. The link
-- closes a cycle when the walk reaches the requiring cell's topic at or above
-- the requiring cell's level.
create or replace function learn.reject_cell_link_cycle()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
declare
  v_topic uuid;
  v_level smallint;
begin
  select topic_id, level into v_topic, v_level
    from learn.topic_cells where id = new.requiring_cell_id;

  if exists (select 1 from learn.topic_cells where id = new.required_cell_id and topic_id = v_topic) then
    raise exception 'cell_links: both cells are on one topic, which the level chain already links'
      using errcode = 'check_violation';
  end if;

  if exists (
    with recursive reach (topic_id, level) as (
      select c.topic_id, c.level from learn.topic_cells c where c.id = new.required_cell_id
      union
      select rc.topic_id, rc.level
        from reach r
        join learn.topic_cells qc on qc.topic_id = r.topic_id and qc.level <= r.level
        join learn.cell_links l on l.requiring_cell_id = qc.id and l.id is distinct from new.id
        join learn.topic_cells rc on rc.id = l.required_cell_id
    )
    select 1 from reach where topic_id = v_topic and level >= v_level
  ) then
    raise exception 'cell_links: % -> % would close a cycle', new.requiring_cell_id, new.required_cell_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function learn.reject_cell_link_cycle() from public, anon, authenticated;

create trigger cell_links_reject_cycle
  before insert or update of requiring_cell_id, required_cell_id on learn.cell_links
  for each row execute function learn.reject_cell_link_cycle();

-- ---------------------------------------------------------------------------
-- Claims attached to a cell: material a question can be written from.
-- A concept from the claims graph or a position from the vault map.
-- ---------------------------------------------------------------------------
create table learn.cell_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cell_id uuid not null,
  concept_id uuid,
  position_id uuid,

  created_at timestamptz not null default now(),

  constraint cell_claims_one_ck check (num_nonnulls(concept_id, position_id) = 1),
  constraint cell_claims_cell_fk
    foreign key (cell_id, user_id) references learn.topic_cells (id, user_id) on delete cascade,
  constraint cell_claims_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint cell_claims_position_fk
    foreign key (position_id, user_id) references obsidian.positions (id, user_id) on delete cascade
);

create unique index if not exists cell_claims_concept_uq on learn.cell_claims (cell_id, concept_id)
  where concept_id is not null;
create unique index if not exists cell_claims_position_uq on learn.cell_claims (cell_id, position_id)
  where position_id is not null;
create index if not exists cell_claims_concept_idx on learn.cell_claims (concept_id) where concept_id is not null;
create index if not exists cell_claims_position_idx on learn.cell_claims (position_id) where position_id is not null;

-- ---------------------------------------------------------------------------
-- Evidence about a cell. Only a graded answer or a declaration writes here
-- (rule R1); a met verdict carries the quote that shows it when it came from
-- an explanation (rule R2), and not met is written only for the cell a
-- question asked about (rule R3). Rows are never edited; a later row
-- supersedes an earlier one.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'probes_user_id_uq' and conrelid = 'learn.probes'::regclass
  ) then
    alter table learn.probes add constraint probes_user_id_uq unique (id, user_id);
  end if;
end;
$$;

create table learn.cell_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cell_id uuid not null,

  verdict text not null,
  -- The question it came from. Null on a declaration, and on evidence carried
  -- over from the claims graph without a probe.
  probe_id uuid,
  -- The span of the answer that meets the cell, verbatim.
  quote text,
  -- When it was shown, which the migration from the claims graph backdates.
  observed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  constraint cell_evidence_verdict_ck check (verdict in ('met', 'not_met', 'declared')),
  constraint cell_evidence_quote_ck check (quote is null or (verdict = 'met' and quote <> '')),
  constraint cell_evidence_declared_ck check (verdict <> 'declared' or probe_id is null),
  constraint cell_evidence_user_id_uq unique (id, user_id),
  constraint cell_evidence_cell_fk
    foreign key (cell_id, user_id) references learn.topic_cells (id, user_id) on delete cascade,
  constraint cell_evidence_probe_fk
    foreign key (probe_id, user_id) references learn.probes (id, user_id) on delete cascade
);

create index if not exists cell_evidence_cell_idx on learn.cell_evidence (cell_id, observed_at desc);
create index if not exists cell_evidence_user_idx on learn.cell_evidence (user_id, observed_at desc);
create index if not exists cell_evidence_probe_idx on learn.cell_evidence (probe_id) where probe_id is not null;

-- ---------------------------------------------------------------------------
-- Lenses: a named set of topics, each with a target level.
-- ---------------------------------------------------------------------------
create table learn.lenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  origin text not null,
  -- The subject a lens was made from, when it was one.
  subject_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lenses_name_ck check (name <> ''),
  constraint lenses_origin_ck check (origin in ('subject', 'goal')),
  constraint lenses_subject_ck check (subject_id is null or origin = 'subject'),
  constraint lenses_user_id_uq unique (id, user_id),
  constraint lenses_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete set null (subject_id)
);

create index if not exists lenses_user_idx on learn.lenses (user_id, name);
create unique index if not exists lenses_subject_uq on learn.lenses (subject_id) where subject_id is not null;

create trigger lenses_touch_updated_at
  before update on learn.lenses
  for each row execute function learn.touch_updated_at();

create table learn.lens_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lens_id uuid not null,
  topic_id uuid not null,
  target_level smallint not null,

  -- When the topic joined the lens, so the lens page can say why progress fell.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lens_targets_level_ck check (target_level between 1 and 10),
  constraint lens_targets_pair_uq unique (lens_id, topic_id),
  constraint lens_targets_lens_fk
    foreign key (lens_id, user_id) references learn.lenses (id, user_id) on delete cascade,
  constraint lens_targets_topic_fk
    foreign key (topic_id, user_id) references learn.topics (id, user_id) on delete cascade
);

create index if not exists lens_targets_topic_idx on learn.lens_targets (topic_id);

create trigger lens_targets_touch_updated_at
  before update on learn.lens_targets
  for each row execute function learn.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Link reviews: a link whose requiring cell was shown again while its
-- required cell was still missed. The person decides whether the link goes.
-- ---------------------------------------------------------------------------
create table learn.link_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Null once the link is removed, so the decision stays on record.
  link_id uuid,
  -- The answer that showed the requiring cell again, and the miss on the
  -- required cell it disagrees with.
  shown_evidence_id uuid not null,
  missed_evidence_id uuid not null,

  decision text,
  decided_at timestamptz,

  created_at timestamptz not null default now(),

  constraint link_reviews_decision_ck check (decision is null or decision in ('keep', 'remove')),
  constraint link_reviews_decided_ck check ((decision is null) = (decided_at is null)),
  constraint link_reviews_link_fk
    foreign key (link_id, user_id) references learn.cell_links (id, user_id) on delete set null (link_id),
  constraint link_reviews_shown_fk
    foreign key (shown_evidence_id, user_id) references learn.cell_evidence (id, user_id) on delete cascade,
  constraint link_reviews_missed_fk
    foreign key (missed_evidence_id, user_id) references learn.cell_evidence (id, user_id) on delete cascade
);

create unique index if not exists link_reviews_open_uq on learn.link_reviews (link_id)
  where decision is null and link_id is not null;
create index if not exists link_reviews_user_idx on learn.link_reviews (user_id, created_at desc);
create index if not exists link_reviews_shown_idx on learn.link_reviews (shown_evidence_id);
create index if not exists link_reviews_missed_idx on learn.link_reviews (missed_evidence_id);

-- ---------------------------------------------------------------------------
-- Row level security: each account's own rows.
-- ---------------------------------------------------------------------------
alter table learn.topics enable row level security;
alter table learn.topic_cells enable row level security;
alter table learn.cell_links enable row level security;
alter table learn.cell_claims enable row level security;
alter table learn.cell_evidence enable row level security;
alter table learn.lenses enable row level security;
alter table learn.lens_targets enable row level security;
alter table learn.link_reviews enable row level security;

create policy topics_all on learn.topics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy topic_cells_all on learn.topic_cells for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy cell_links_all on learn.cell_links for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy cell_claims_all on learn.cell_claims for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy cell_evidence_all on learn.cell_evidence for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy lenses_all on learn.lenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy lens_targets_all on learn.lens_targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy link_reviews_all on learn.link_reviews for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.topics, learn.topic_cells, learn.cell_links, learn.cell_claims,
  learn.cell_evidence, learn.lenses, learn.lens_targets, learn.link_reviews from anon;

grant select, insert, update, delete on learn.topics, learn.topic_cells, learn.cell_links,
  learn.cell_claims, learn.cell_evidence, learn.lenses, learn.lens_targets, learn.link_reviews
  to authenticated, service_role;
