-- Research runs on an essay (plan #1863.9; LEARN-ESSAYS-SPEC "Research, when
-- you ask" and "Schema").
--
-- learn.essay_research, one row per run that came back:
--   essay_id     the essay. Removed with it.
--   level        'first' (web searches on the essay's question, positions
--                with sources) or 'deeper' (searches and full pages read,
--                each claim in the draft marked against them).
--   question     what was researched, as the brief had it when the run started.
--   queries      the searches the model ran, as the API reported them.
--   sources      [{url, title, domain, text}]: every page cited, with the text
--                kept for a page the deeper pass read in full (null otherwise).
--   findings     the positions (first pass) or the claims (deeper pass), each
--                with its citations: the source's index and the quoted words
--                exactly as the API's citation gave them, and for a claim the
--                stance and the count of sources for and against.
--   cost_micros  what the run cost, from the API's usage, in millionths of a
--                dollar. The spend ledger has the same figure by operation.
--   model        the models the run used, comma separated.
-- Dash retrieved and wrote these, so not a source.

set search_path = learn, public, extensions;

create table if not exists learn.essay_research (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  level text not null,
  question text not null default '',
  queries text[] not null default '{}',
  sources jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  cost_micros bigint,
  model text not null default '',
  created_at timestamptz not null default now(),
  constraint essay_research_essay_fk
    foreign key (essay_id, user_id) references learn.essays (id, user_id)
    on delete cascade,
  constraint essay_research_level_check check (level in ('first', 'deeper')),
  constraint essay_research_sources_array check (jsonb_typeof(sources) = 'array'),
  constraint essay_research_findings_array check (jsonb_typeof(findings) = 'array')
);

create index if not exists essay_research_essay_idx
  on learn.essay_research (essay_id, level, created_at desc);

create index if not exists essay_research_user_idx
  on learn.essay_research (user_id);

alter table learn.essay_research enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'essay_research' and policyname = 'essay_research_all'
  ) then
    create policy essay_research_all on learn.essay_research for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.essay_research from anon, authenticated;
grant select, insert, update, delete on learn.essay_research to authenticated, service_role;

comment on table learn.essay_research is
  'Research runs on an essay: the searches, the pages cited and what each said, and the cost (plan #1863.9).';
