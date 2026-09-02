-- The vault: a fourth schema, for the Obsidian notes.
--
-- Not `core`, deliberately. core is for facts that arrive on a shared sync and
-- that neither workspace owns -- an order confirmation and a rejection letter
-- pulled from the same mailbox. The vault has its own transport and, today,
-- exactly one consumer. Putting it in core would claim a generality it has not
-- earned, and would give both workspaces a dependency neither of them asked
-- for.
--
-- Three tables and nothing clever:
--
--   vault.vault_connections  the git remote and its encrypted token
--   vault.notes              one row per .md file, keyed by repo path
--   vault.sync_runs          what a sync run did, including what it skipped
--
-- Everything in here is read-only from the app's point of view. Obsidian is
-- the only writer of a vault; this schema is a mirror of one, and the sync is
-- one-way forever. See docs/VAULT-SPEC.md.

create schema if not exists vault;

set search_path = vault, public, extensions;

-- ---------------------------------------------------------------------------
-- Enums.
--
-- `provider` has exactly one value today. It exists anyway so that a second
-- source -- a local folder, GitLab, anything -- is a new enum value and a new
-- file under lib/vault/providers/, rather than a migration that adds a column
-- to a table with rows in it.
-- ---------------------------------------------------------------------------
create type vault.vault_provider as enum ('github');

create type vault.vault_connection_status as enum (
  'active',
  'needs_reauth',
  'disconnected',
  'error'
);

create type vault.sync_run_type as enum ('backfill', 'incremental');

create type vault.sync_run_status as enum ('queued', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- The connection.
--
-- Shaped after core.email_accounts on purpose: same status vocabulary, same
-- encrypted-token column, same cursor idea. A fine-grained PAT expires where a
-- refresh token does not, which is the one real difference and the reason
-- `token_expires_at` is here -- a vault that quietly stopped syncing six weeks
-- ago is worse than one that says it needs reconnecting.
-- ---------------------------------------------------------------------------
create table vault.vault_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider vault.vault_provider not null default 'github',

  repo_owner text not null,
  repo_name text not null,
  branch text not null,
  -- When the vault is a subdirectory of the repo rather than its root. Stored
  -- without leading or trailing slashes; '' means the whole repo.
  subpath text not null default '',

  -- Encrypted with TOKEN_ENCRYPTION_KEY through lib/crypto/tokens.ts, exactly
  -- as the Gmail refresh token is. Never returned to a client.
  access_token text,
  token_expires_at timestamptz,

  -- The last commit SHA whose tree is fully reflected in vault.notes. Null
  -- until the first backfill finishes -- a half-read vault must not look
  -- caught up, because the next run would then only ask for changes since a
  -- point it never actually reached.
  sync_cursor text,
  -- Where a backfill stopped when it ran out of budget: the last path written,
  -- in sort order. Null when no backfill is in flight.
  backfill_after_path text,
  -- The commit a backfill in flight is reading. Kept so a backfill that spans
  -- several runs stays on one tree rather than drifting forward under itself.
  backfill_commit_sha text,
  backfill_completed_at timestamptz,

  status vault.vault_connection_status not null default 'active',
  last_error text,
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vault_connections_repo_owner_ck check (repo_owner <> ''),
  constraint vault_connections_repo_name_ck check (repo_name <> ''),
  constraint vault_connections_branch_ck check (branch <> ''),
  -- Normalised on the way in, so path joining never has to guess.
  constraint vault_connections_subpath_ck
    check (subpath !~ '^/' and subpath !~ '/$')
);

-- One vault per user in v1. The uniqueness is on the user rather than on the
-- repository so that lifting the restriction later is a dropped index and not
-- a data migration.
create unique index vault_connections_user_key on vault.vault_connections (user_id);

-- ---------------------------------------------------------------------------
-- The notes.
--
-- `path` is the natural key and `blob_sha` is git's own content hash, which
-- means change detection costs nothing: an unchanged blob is never fetched.
--
-- Deletes are soft. If Obsidian Git ever pushes a commit that drops files --
-- a bad merge, a sync conflict resolved the wrong way -- this sync will
-- faithfully mirror that, and the app must never be the reason something is
-- gone. A later commit restoring the path revives the row, and its id, which
-- matters more than it looks: a note is going to be cited by an evidence item
-- eventually, and a citation must not be orphaned by a bad afternoon.
-- ---------------------------------------------------------------------------
create table vault.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references vault.vault_connections (id) on delete cascade,

  -- Repo-relative, '.md' included, no leading slash.
  path text not null,
  title text not null,
  body text not null,
  frontmatter jsonb not null default '{}'::jsonb,

  -- git's blob SHA for the file's content. Content dedup, free.
  blob_sha text not null,
  size_bytes int not null default 0,
  -- Commit time of the last change to this path, when the sync knows it.
  git_updated_at timestamptz,

  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notes_path_ck check (path <> '' and path !~ '^/'),
  constraint notes_path_is_markdown_ck check (path ~* '\.md$')
);

create unique index notes_user_path_key on vault.notes (user_id, path);
create index notes_user_updated_idx
  on vault.notes (user_id, git_updated_at desc nulls last)
  where deleted_at is null;
create index notes_connection_idx on vault.notes (connection_id);

-- Full-text search over title and body.
--
-- `left(body, ...)` rather than the whole body: a tsvector is capped at about
-- a megabyte, and a single enormous note must not make its own row
-- unwritable. 200k characters is far past where a note stops being a note,
-- and the cap applies to the *index*, not to what is stored or displayed.
alter table vault.notes
  add column search_tsv tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || left(coalesce(body, ''), 200000)
    )
  ) stored;

create index notes_search_idx on vault.notes using gin (search_tsv);

-- Fuzzy title match, the same way job_search indexes questions.text. Wikilink
-- resolution leans on this: `[[Some Note]]` is a title lookup, thousands of
-- times per rendered page in a heavily linked vault.
create index notes_title_trgm_idx on vault.notes using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Sync runs.
--
-- core.sync_jobs with the vault's counters. `notes_skipped` is not decoration:
-- a note too large to store is skipped rather than fatal, and a skip that is
-- not counted anywhere is a note that silently does not exist.
-- ---------------------------------------------------------------------------
create table vault.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references vault.vault_connections (id) on delete cascade,
  type vault.sync_run_type not null,
  status vault.sync_run_status not null default 'queued',

  from_sha text,
  to_sha text,

  notes_seen int not null default 0,
  notes_written int not null default 0,
  notes_deleted int not null default 0,
  notes_skipped int not null default 0,

  started_at timestamptz,
  finished_at timestamptz,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_runs_connection_idx
  on vault.sync_runs (connection_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at. Its own copy, as job_search has its own copy, so the schema
-- does not depend on another schema's function surviving a refactor.
-- ---------------------------------------------------------------------------
create or replace function vault.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function vault.touch_updated_at() set search_path = vault;

do $$
declare
  t text;
begin
  foreach t in array array['vault_connections', 'notes', 'sync_runs'] loop
    execute format(
      'create trigger %I before update on vault.%I
         for each row execute function vault.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end;
$$;

-- EXECUTE is checked when a trigger is created, not when it fires, so this
-- does not break writes. It keeps the function off the PostgREST RPC surface.
revoke all on function vault.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Every table, from the first migration.
--
-- notes and sync_runs both hang off a connection, but notes also carries its
-- own user_id -- the list page filters by it on every request, and reaching
-- through a join for that is a subquery per row on the hottest read in the
-- workspace. The two must agree, which the trigger below enforces rather than
-- trusting the writer.
-- ---------------------------------------------------------------------------
alter table vault.vault_connections enable row level security;
alter table vault.notes enable row level security;
alter table vault.sync_runs enable row level security;

create policy vault_connections_select on vault.vault_connections for select to authenticated
  using (user_id = (select auth.uid()));
create policy vault_connections_insert on vault.vault_connections for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy vault_connections_update on vault.vault_connections for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy vault_connections_delete on vault.vault_connections for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notes_all on vault.notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_runs_all on vault.sync_runs for all to authenticated
  using (exists (
    select 1 from vault.vault_connections c
    where c.id = sync_runs.connection_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from vault.vault_connections c
    where c.id = sync_runs.connection_id and c.user_id = (select auth.uid())
  ));

-- A note's user_id is denormalised from its connection for the sake of the
-- list query's index. Denormalised ownership that can disagree with the real
-- owner is a hole in RLS, so the database keeps them equal rather than the
-- sync remembering to.
create or replace function vault.notes_owner_matches_connection()
returns trigger
language plpgsql
security definer
set search_path = vault
as $$
declare
  owner uuid;
begin
  select user_id into owner from vault.vault_connections where id = new.connection_id;
  if owner is null or owner <> new.user_id then
    raise exception 'note user_id must match its connection owner';
  end if;
  return new;
end;
$$;

create trigger notes_owner_matches_connection
  before insert or update of user_id, connection_id on vault.notes
  for each row execute function vault.notes_owner_matches_connection();

revoke all on function vault.notes_owner_matches_connection() from public, anon, authenticated;

-- Nothing here is readable by an anonymous visitor.
revoke all on all tables in schema vault from anon;

grant usage on schema vault to authenticated, service_role;
grant select, insert, update, delete on all tables in schema vault to authenticated, service_role;
