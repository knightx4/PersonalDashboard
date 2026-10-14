-- Links between ideas and the evidence for them (plan #2006.1).
--
-- Learn so far knows what you know from quizzes and from what you declare.
-- Your notes, the courses you took and the work you have done say a good deal
-- more. This table records that an idea is backed by one of them, so the
-- strength score and the idea's card can say "from MGT 541 Corporate Finance
-- (A)" or "you wrote about this in ...".
--
-- learn.evidence_links, one row per target and piece of evidence:
--   target_kind  what is backed: 'idea' (a learn.concepts row) or 'topic' (a
--                Level 3 or 4 topic, which has no table of its own).
--   target_id    the id of that idea or topic.
--   source_kind  what backs it: note, course, work, reading or video.
--   source_id    the id of the source in its own table, as text since a video
--                is named by its YouTube id and the rest by a uuid.
--   similarity   how close the match is (0 to 1).
--   weight       how much the link counts (0 to 1), set by the kind of source:
--                your own writing counts fully, a clipping a quarter, a graded
--                course by its grade and age.
--   basis        one sentence saying why it counts.
--   found_at     when the link was found.
--
-- Unique on the target and the source, so finding the same link again updates
-- it. A link to an idea goes with the idea; a link to a topic has nothing to
-- cascade from, so its writer clears it.

set search_path = learn, public, extensions;

create table if not exists learn.evidence_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  source_kind text not null,
  source_id text not null,
  similarity real not null,
  weight real not null,
  basis text not null,
  found_at timestamptz not null default now(),
  constraint evidence_links_target_kind_ck check (target_kind in ('idea', 'topic')),
  constraint evidence_links_source_kind_ck
    check (source_kind in ('note', 'course', 'work', 'reading', 'video')),
  constraint evidence_links_source_id_ck check (source_id <> ''),
  constraint evidence_links_similarity_ck check (similarity >= 0 and similarity <= 1),
  constraint evidence_links_weight_ck check (weight >= 0 and weight <= 1),
  constraint evidence_links_basis_ck check (basis <> ''),
  constraint evidence_links_link_uq
    unique (user_id, target_kind, target_id, source_kind, source_id)
);

-- An idea's evidence, strongest first.
create index if not exists evidence_links_target_idx
  on learn.evidence_links (user_id, target_kind, target_id, weight desc);
-- Everything one source backs, to refresh it when the source changes.
create index if not exists evidence_links_source_idx
  on learn.evidence_links (user_id, source_kind, source_id);

alter table learn.evidence_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'evidence_links' and policyname = 'evidence_links_read'
  ) then
    create policy evidence_links_read on learn.evidence_links for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

-- The links are found by the daily run, so the person reads them and the
-- service role writes them.
revoke all on learn.evidence_links from anon, authenticated;
grant select on learn.evidence_links to authenticated;
grant select, insert, update, delete on learn.evidence_links to service_role;

-- A link to an idea goes with the idea.
create or replace function learn.evidence_links_forget_idea()
returns trigger
language plpgsql
security invoker
set search_path = learn, public
as $$
begin
  delete from learn.evidence_links
  where user_id = old.user_id and target_kind = 'idea' and target_id = old.id;
  return old;
end;
$$;

create or replace trigger evidence_links_forget_idea
  after delete on learn.concepts
  for each row execute function learn.evidence_links_forget_idea();

comment on table learn.evidence_links is
  'What backs an idea or a topic: a note, course, piece of work, reading or video, with how close the match is, how much it counts and why (plan #2006.1).';
