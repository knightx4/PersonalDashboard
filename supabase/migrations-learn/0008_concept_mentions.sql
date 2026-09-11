-- One claim referring to another, which is not the same thing as needing it.
--
-- Settled in plan #149. `learn.concept_edges` cannot carry this: an edge is a
-- prerequisite claim, it is acyclic by trigger, and two claims that talk about
-- each other are exactly the cycle the trigger refuses. So a mention is a
-- second relation with a table of its own.
--
-- The rule that makes it safe to have two relations: nothing that walks the
-- graph reads this table. The pruning rule, the learning order and "what is
-- ready now" all run on `concept_edges` alone. A mention is a way across the
-- graph sideways -- from the claim you are reading to another claim it talks
-- about -- and never a claim about what has to be learned first. Mixing the
-- two would put cycles back into the walk that the trigger above exists to
-- keep out.
--
-- Written going forward only, by the import that looked for them and by the
-- branch action. A graph built before this table existed has none, and nothing
-- backfills it: a mention carries a basis written while the claim was being
-- read, and a basis invented later by matching names against claim text is the
-- silent guess this module is built against.

set search_path = learn, public, extensions;

create table learn.concept_mentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  -- The claim that does the referring, and the one it refers to.
  source_id uuid not null,
  target_id uuid not null,

  -- Why one is said to refer to the other, in a sentence, and shown. The same
  -- discipline as `concept_edges.basis`: a link nobody can argue with is a
  -- link nobody can correct.
  basis text not null,

  created_at timestamptz not null default now(),

  constraint concept_mentions_basis_ck check (basis <> ''),
  constraint concept_mentions_not_self_ck check (source_id <> target_id),
  -- One row per direction. A referring to B and B referring to A are two
  -- claims with two different bases, and both are allowed at once -- that is
  -- the whole reason this is not an edge.
  constraint concept_mentions_pair_uq unique (source_id, target_id),

  constraint concept_mentions_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  -- Both ends in this subject, by the key rather than by a check, exactly as
  -- an edge is: a mention across two subjects would make "one graph per
  -- subject" false quietly.
  constraint concept_mentions_source_fk
    foreign key (source_id, subject_id) references learn.concepts (id, subject_id) on delete cascade,
  constraint concept_mentions_target_fk
    foreign key (target_id, subject_id) references learn.concepts (id, subject_id) on delete cascade
);

-- Both directions are read on every concept page, so both get an index.
create index concept_mentions_source_idx on learn.concept_mentions (source_id);
create index concept_mentions_target_idx on learn.concept_mentions (target_id);
create index concept_mentions_subject_idx on learn.concept_mentions (subject_id);

alter table learn.concept_mentions enable row level security;

create policy concept_mentions_all on learn.concept_mentions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.concept_mentions from anon;

grant select, insert, update, delete on learn.concept_mentions
  to authenticated, service_role;
