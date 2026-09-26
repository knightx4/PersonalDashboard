-- Files: a piece of writing kept as its own page.
--
-- Until now, what Claude produced for a goal step was stored on the step
-- (goals.items.result) and read there. A long piece, such as your applications
-- broken down by role family, was squeezed into a step's result, could not be
-- built on by a later step, and was lost from view once the step was read. A
-- file is that piece as a page of its own: it has a title, it opens at
-- /goals/files/<id>, it can be revised, and anything that needs it can link to
-- it. Goals links a goal or a step to a file through goals.links (kind
-- 'file', migrations-goals/0044), and the step's result becomes a short
-- summary pointing at it.
--
-- It lives in core because it is not a goals thing. Goals is the first module
-- to write one; a jobs prep note or a digest is the same kind of object.
--
-- The body is markdown with no fixed structure. What a file should hold is in
-- the goals skill's guidelines, not in a schema, because a file can be a
-- research note, a comparison, a plan or a letter.
--
-- `origin` records where the file came from, as `schema.table:ref` in the
-- form goals.records.source_ref already uses: the step that asked for it,
-- usually. There is no foreign key: core is built before the module schemas
-- and cannot point into them. `made_by` is 'claude' for a file a run wrote
-- and 'you' for one the person wrote.
--
-- Every change to the title or body is kept. The trigger below numbers each
-- version and copies it into core.file_versions, with `change_note` (what
-- this version changed) alongside, so a file can be worked on over several
-- runs and every earlier version can still be read. The versions table is
-- written only by that trigger.

set search_path = core, public, extensions;

create table core.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  -- One or two sentences saying what the file concludes, for lists and links.
  summary text,
  body text not null,

  made_by text not null default 'you',
  -- Where it came from, as `schema.table:ref`; usually the step that asked for it.
  origin text,

  version integer not null default 1,
  -- What the newest version changed. Copied into its row in core.file_versions.
  change_note text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint files_title_ck check (btrim(title) <> '' and length(title) <= 200),
  constraint files_summary_ck check (summary is null or (btrim(summary) <> '' and length(summary) <= 600)),
  constraint files_body_ck check (btrim(body) <> '' and length(body) <= 200000),
  constraint files_made_by_ck check (made_by in ('claude', 'you')),
  constraint files_origin_ck check (origin is null or origin ~ '^[a-z_]+\.[a-z_]+:.+$'),
  constraint files_change_note_ck check (change_note is null or (btrim(change_note) <> '' and length(change_note) <= 500)),
  constraint files_version_ck check (version >= 1)
);

-- What the versions' composite foreign key points at.
create unique index files_id_user_uq on core.files (id, user_id);
-- The list, newest first.
create index files_user_updated_idx on core.files (user_id, updated_at desc) where archived_at is null;

create table core.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,

  version integer not null,
  title text not null,
  body text not null,
  made_by text not null,
  change_note text,

  created_at timestamptz not null default now(),

  constraint file_versions_file_fk foreign key (file_id, user_id)
    references core.files (id, user_id) on delete cascade,
  constraint file_versions_version_uq unique (file_id, version)
);

create index file_versions_user_idx on core.file_versions (user_id);

-- A new title or body is a new version: numbered here, before the row is
-- written, so the row and its copy agree. An edit that changes neither (a
-- summary, archiving) keeps the number. A change note belongs to the version
-- it was written with, so one left over from the last version is cleared
-- unless this edit sets its own.
create or replace function core.files_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;
  new.updated_at := now();
  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.version := old.version + 1;
    if new.change_note is not distinct from old.change_note then
      new.change_note := null;
    end if;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

-- The copy. Security definer because nobody but this trigger may write a
-- version, so the signed-in role has no insert grant on the table.
create or replace function core.files_keep_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into core.file_versions (file_id, user_id, version, title, body, made_by, change_note)
    values (new.id, new.user_id, new.version, new.title, new.body, new.made_by, new.change_note);
  end if;
  return null;
end;
$$;

revoke all on function core.files_version() from public, anon, authenticated;
revoke all on function core.files_keep_version() from public, anon, authenticated;

create trigger files_version before insert or update on core.files
  for each row execute function core.files_version();

create trigger files_keep_version after insert or update on core.files
  for each row execute function core.files_keep_version();

alter table core.files enable row level security;
alter table core.file_versions enable row level security;

create policy files_all on core.files for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy file_versions_select on core.file_versions for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.files from anon;
revoke all on core.file_versions from anon;
grant select, insert, update on core.files to authenticated;
grant select, insert, update, delete on core.files to service_role;
grant select on core.file_versions to authenticated;
grant select, insert, delete on core.file_versions to service_role;

comment on table core.files is
  'A piece of writing kept as its own page: a research note, a breakdown, a plan. Markdown, revised in place, every version kept in core.file_versions. Goals links to one through goals.links.';
comment on table core.file_versions is
  'Every version of a file in core.files, written only by its trigger.';

notify pgrst, 'reload schema';
