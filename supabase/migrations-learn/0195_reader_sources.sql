-- The reader: real sources, prepared ahead of time (docs/LEARN-READER-SPEC.md).
--
--   learn.reader_sources
--       One row per thing to read: an essay, a paper, a chapter. `prepared`
--       is the whole prepared source as one document
--       (lib/learn/reader/source.ts gives its shape and checks it): the
--       context, the work in brief, its one idea, and its sections, each
--       with its own context, summary, idea, the text itself where it may be
--       shown, notes on its hard phrases, a question and a figure.
--
--       Nothing here is written by an API call. A Claude Code routine
--       prepares a source (.claude/skills/learn-reader/SKILL.md) and saves
--       it through scripts/learn-reader.ts. Opening, reading and marking a
--       section read call no model at all.
--
--       `origin` says why the row exists: `note` (chosen against one of the
--       person's vault notes), `new` (territory they have not touched),
--       `asked` (they typed a topic, pasted a link or a text), `deeper`
--       (they pressed Go deeper on a section of `parent_id`), `refill` (a
--       request for more to read, which adds other rows and is never shown
--       itself).
--
--       `basis` says what the summaries rest on: `text` (the text is here),
--       `read` (the text was read but may not be shown) or `memory` (written
--       from knowledge of the work, unchecked until the person adds their
--       copy in `given_text`).
--
--       status: queued, preparing (a session has taken it), ready or failed.
--       `progress` holds the sections read. `verdict` is the person's: kept,
--       or dropped ("not for me"), which steers what is found next.

set search_path = learn, public, extensions;

create table if not exists learn.reader_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reading_id uuid references learn.readings (id) on delete set null,
  parent_id uuid references learn.reader_sources (id) on delete set null,
  parent_section integer,
  title text not null,
  author text,
  origin text not null default 'asked',
  asked text,
  why text,
  given_text text,
  status text not null default 'queued',
  basis text,
  prepared jsonb,
  progress jsonb not null default '{}'::jsonb,
  verdict text,
  error text,
  requested_at timestamptz not null default now(),
  taken_at timestamptz,
  prepared_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reader_sources_title_ck check (length(btrim(title)) between 1 and 300),
  constraint reader_sources_origin_ck check (origin in ('note', 'new', 'asked', 'deeper', 'refill')),
  constraint reader_sources_status_ck check (status in ('queued', 'preparing', 'ready', 'failed')),
  constraint reader_sources_basis_ck check (basis is null or basis in ('text', 'read', 'memory')),
  constraint reader_sources_verdict_ck check (verdict is null or verdict in ('kept', 'dropped')),
  constraint reader_sources_ready_ck check (status <> 'ready' or prepared is not null or origin = 'refill'),
  constraint reader_sources_given_ck check (given_text is null or length(given_text) <= 600000)
);

create index if not exists reader_sources_user_status_idx on learn.reader_sources (user_id, status, requested_at);
create index if not exists reader_sources_parent_idx on learn.reader_sources (parent_id) where parent_id is not null;
create unique index if not exists reader_sources_reading_uq on learn.reader_sources (user_id, reading_id) where reading_id is not null;

alter table learn.reader_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'learn' and tablename = 'reader_sources' and policyname = 'reader_sources_own'
  ) then
    create policy reader_sources_own on learn.reader_sources for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.reader_sources from anon, authenticated;
grant select, insert, update on learn.reader_sources to authenticated;
grant select, insert, update, delete on learn.reader_sources to service_role;

comment on table learn.reader_sources is
  'Something to read, prepared ahead of time by a routine: its context, layered summaries, the text where it may be shown, and what the person has read of it (docs/LEARN-READER-SPEC.md).';
comment on column learn.reader_sources.prepared is
  'The prepared source as one document; lib/learn/reader/source.ts gives its shape and checks it.';
comment on column learn.reader_sources.basis is
  'What the summaries rest on: text (shown here), read (read but not shown) or memory (unchecked until the person adds their copy).';
