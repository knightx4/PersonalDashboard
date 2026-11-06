-- What kind of idea each position is, and how useful and novel Jev finds it
-- (plan #2947.1).
--
-- A position is scored once Jev has sorted it as the person's own idea or a
-- design for something they are building; any other type is stored with null
-- scores, so the sweep does not ask again. Each score is out of 100, from the
-- probability-weighted level of ten levels (0 to 9). The ten probabilities are
-- kept beside the score, with the rubric version and a hash of what Jev read,
-- so a changed idea or a changed rubric is re-scored.

set search_path = obsidian, public, extensions;

create table obsidian.position_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid not null unique references obsidian.positions (id) on delete cascade,
  idea_type text not null,
  usefulness smallint,
  novelty smallint,
  usefulness_confidence real,
  novelty_confidence real,
  usefulness_levels jsonb,
  novelty_levels jsonb,
  type_probabilities jsonb,
  model text not null,
  rubric_version text not null,
  input_hash text not null,
  scored_at timestamptz not null default now(),

  constraint position_scores_type_ck check (
    idea_type in ('own_idea', 'project_design', 'requirement', 'others_idea', 'description')
  ),
  constraint position_scores_usefulness_ck check (usefulness is null or usefulness between 0 and 100),
  constraint position_scores_novelty_ck check (novelty is null or novelty between 0 and 100),
  constraint position_scores_confidence_ck check (
    (usefulness_confidence is null or usefulness_confidence between 0 and 1)
    and (novelty_confidence is null or novelty_confidence between 0 and 1)
  ),
  -- Scores belong to the two scored types and to no other.
  constraint position_scores_gate_ck check (
    case
      when idea_type in ('own_idea', 'project_design')
        then usefulness is not null and novelty is not null
      else usefulness is null and novelty is null
    end
  )
);

create index position_scores_user_usefulness_idx
  on obsidian.position_scores (user_id, usefulness desc);
create index position_scores_user_novelty_idx
  on obsidian.position_scores (user_id, novelty desc);

alter table obsidian.position_scores enable row level security;

create policy position_scores_all on obsidian.position_scores for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on obsidian.position_scores to authenticated, service_role;
revoke all on obsidian.position_scores from anon;

comment on table obsidian.position_scores is
  'The type Jev gave each position and, for own ideas and project designs, usefulness and novelty out of 100 (plan #2947).';
