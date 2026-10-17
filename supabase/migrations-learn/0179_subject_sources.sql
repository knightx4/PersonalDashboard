-- The documents a person added to a subject with Add a source (plan #2307.4).
--
-- Add a source fetches a page or searches for documents, stores what it finds
-- in the shared bank as structure documents (learn.catalogue_structures), and
-- matches their weeks into the subject's preparation. This table records
-- which subject each added document belongs to, so the Sources section can
-- list it and a later match_weeks pass keeps its weeks.
--
-- learn.subject_sources, one row per document added to a subject:
--   item_id      the stored document (learn.catalogue_items, kind structure)
--   asked        what the person typed: the address, or the search phrase
--                that found it
--   added_at
--
-- The provider `web` is the one a page from a site with no reader of its
-- own is stored under: one document per address, its sections read from
-- the page's headings, kept as an outline only (structure_only).

set search_path = learn, public, extensions;

create table if not exists learn.subject_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references learn.subjects (id) on delete cascade,
  item_id uuid not null references learn.catalogue_items (id) on delete cascade,
  asked text not null check (length(asked) between 1 and 2000),
  added_at timestamptz not null default now(),
  unique (subject_id, item_id)
);

create index if not exists subject_sources_user_idx on learn.subject_sources (user_id, subject_id, added_at);

comment on table learn.subject_sources is
  'Documents a person added to a subject with Add a source (plan #2307.4). The document itself is shared catalogue data; this row says whose subject it was added to.';
comment on column learn.subject_sources.asked is
  'What the person typed: the address fetched, or the search phrase that found the document.';

alter table learn.subject_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'subject_sources' and policyname = 'subject_sources_own'
  ) then
    create policy subject_sources_own on learn.subject_sources for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end;
$$;

grant select, insert, delete on learn.subject_sources to authenticated;
grant select, insert, update, delete on learn.subject_sources to service_role;

insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, enabled)
values
  -- No home of its own: each document's address is its own item's
  -- canonical_url. The column needs an https address, so it names the web's.
  ('web', 'Web page', 'https://www.w3.org/WWW/',
   'Copyright of the page''s owner; structure only',
   'A page added by address from a site with no reader of its own: its sections are the page''s headings. Kept as an outline only.',
   true)
on conflict (slug) do nothing;
