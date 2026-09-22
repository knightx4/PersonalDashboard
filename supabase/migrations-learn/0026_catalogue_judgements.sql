-- What the judge made of each section it read.
--
-- `catalogue_links` stores the sections the judge accepted and nothing else. A
-- section it refused leaves no row anywhere, so the section trial (#760) cannot
-- say how many candidates came back above the floor, how many were refused, or
-- whether acceptance moved with the length of the section. The press knows all
-- three and until now kept only the counts, in memory, for one log line.
--
-- One row per judging call: the section, how close retrieval put it to the
-- claim, the verdict, and the press it belonged to. `pressed_at` is shared by
-- every row one press writes, so grouping on it gives one press back.
--
-- **Only candidates that were judged.** A candidate already linked costs no
-- call and has no verdict of its own, and a press skipped because nothing new
-- had been embedded judged nothing at all, so neither writes a row.
--
-- **`verdict` is what the judge said, not what happened to the link.** An
-- accepted section whose link insert then failed, or found the link already
-- there, is still `accepted`: the trial is measuring the judge. `failed` is a
-- call that produced no verdict, kept because a run of failures looks exactly
-- like a run of refusals in the counts and should not.
--
-- `similarity` is the cosine retrieval ranked by, 1 for the same direction.
-- The distance is one minus it. `chars` is the length of the section's text,
-- whole: the judge reads the first 16,000 characters, so a row above that was
-- judged on a cut. It is recorded here rather than joined from
-- `catalogue_segments` because a re-fetch rewrites a section in place.
--
-- Written by the press as the signed-in person, so the policies are the ones
-- `catalogue_links` has, less delete. Nothing updates a judgement once made.

set search_path = learn, public, extensions;

create table if not exists learn.catalogue_judgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  segment_id uuid not null references learn.catalogue_segments (id) on delete cascade,

  -- Exactly one, the same as the link the verdict would have written.
  concept_id uuid,
  subject_id uuid,

  similarity double precision not null,
  chars integer not null,
  verdict text not null,
  model text not null,
  pressed_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint catalogue_judgements_verdict_ck check (verdict in ('accepted', 'refused', 'failed')),
  constraint catalogue_judgements_chars_ck check (chars >= 0),
  constraint catalogue_judgements_one_target_ck check (
    (concept_id is not null) <> (subject_id is not null)
  ),
  constraint catalogue_judgements_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint catalogue_judgements_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade
);

comment on table learn.catalogue_judgements is
  'One row per section the catalogue judge read for a claim: its similarity to the claim, its length, and whether it was accepted, refused, or produced no verdict. Written by the read button.';

-- The reads are "every press, newest first" and "every judgement for this
-- claim". The segment index is for the cascade from catalogue_segments.
create index if not exists catalogue_judgements_pressed_idx
  on learn.catalogue_judgements (user_id, pressed_at desc);
create index if not exists catalogue_judgements_concept_idx
  on learn.catalogue_judgements (concept_id)
  where concept_id is not null;
create index if not exists catalogue_judgements_subject_idx
  on learn.catalogue_judgements (subject_id)
  where subject_id is not null;
create index if not exists catalogue_judgements_segment_idx
  on learn.catalogue_judgements (segment_id);

alter table learn.catalogue_judgements enable row level security;

drop policy if exists catalogue_judgements_select on learn.catalogue_judgements;
create policy catalogue_judgements_select on learn.catalogue_judgements for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists catalogue_judgements_insert on learn.catalogue_judgements;
create policy catalogue_judgements_insert on learn.catalogue_judgements for insert to authenticated
  with check (user_id = (select auth.uid()));

grant select, insert on learn.catalogue_judgements to authenticated;
grant all on learn.catalogue_judgements to service_role;
revoke all on table learn.catalogue_judgements from anon;
