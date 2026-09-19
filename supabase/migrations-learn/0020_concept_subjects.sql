-- The other subjects a concept also belongs to.
--
-- A concept has one home subject, `concepts.subject_id`, and that column is
-- doing structural work rather than merely labelling: `concepts_subject_id_uq`
-- exists so `concept_edges` can require both ends of an edge to be in the same
-- subject through a foreign key instead of a check. Take it away and the
-- database stops guaranteeing that an edge is coherent.
--
-- What it cannot express is the concept that genuinely sits in two places.
-- Incentives belong to economics and to urban design; base rates belong to
-- statistics and to decision-making. With one column the vault extraction
-- either files such a concept arbitrarily or writes it twice, and duplicating
-- exactly the concepts that span subjects is the worst available outcome --
-- those are the ones worth having.
--
-- So the home subject stays and this table holds the rest. Every subject a
-- concept is in is its `subject_id` plus its rows here. Deliberately not a
-- mirror of the home subject as well: a row per subject including the home one
-- would be two sources of truth about the same fact, and they would drift the
-- first time one of them was written without the other.
--
-- This is a smaller change than LEARN-MAP-SPEC.md asks for. That document says
-- subjects should be labels and not containers at all, which remains the right
-- end state and is a refactor of 31 files rather than a migration. This buys
-- the half that vault extraction actually needs and forecloses nothing.

set search_path = learn, public, extensions;

create table if not exists learn.concept_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid not null,
  subject_id uuid not null,

  -- Why it also belongs here, in a sentence. The same discipline every other
  -- claim in this schema is held to: an unexplained cross-listing is one
  -- nobody can argue with.
  basis text not null,

  created_at timestamptz not null default now(),

  constraint concept_subjects_basis_ck check (basis <> ''),
  -- Composite, carrying user_id, so a row cannot join one account's concept to
  -- another account's subject. Foreign keys are not subject to RLS, so this is
  -- the only thing that stops it.
  constraint concept_subjects_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint concept_subjects_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint concept_subjects_pair_uq unique (user_id, concept_id, subject_id)
);

-- The reverse lookup: everything cross-listed into one subject.
create index if not exists concept_subjects_subject_idx
  on learn.concept_subjects (subject_id, concept_id);

alter table learn.concept_subjects enable row level security;

drop policy if exists concept_subjects_select on learn.concept_subjects;
create policy concept_subjects_select on learn.concept_subjects for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists concept_subjects_insert on learn.concept_subjects;
create policy concept_subjects_insert on learn.concept_subjects for insert to authenticated
  with check (user_id = (select auth.uid()));
-- No update policy. A row is the pair it names; changing either end is a
-- different cross-listing, which is a delete and an insert.
drop policy if exists concept_subjects_delete on learn.concept_subjects;
create policy concept_subjects_delete on learn.concept_subjects for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on learn.concept_subjects to authenticated;

revoke all on table learn.concept_subjects from anon;
