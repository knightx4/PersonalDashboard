-- Which newsletter stories are the same event (plan #864, under #862).
--
-- When a newsletter is summarised, each of its stories is embedded and
-- compared with the stories of the last two days from other newsletters
-- (#863 chose embeddings; #873 set the cut-off at 0.80 from #872's
-- measurement). A story that matches joins the group of its best match; one
-- that matches nothing starts a group of its own, which is how a story with no
-- repeat is left alone: nothing else shares its group_id.
--
-- Every summarised story therefore has one row, and the row keeps the story's
-- embedding. A later newsletter is compared against these stored vectors
-- rather than re-embedding two days of stories on every arrival, which the
-- Voyage key's rate (three requests a minute) would not allow. The vector is
-- the same shape as obsidian.themes (migrations-vault/0006): 1,024 wide, from
-- the Voyage 4 family, with the model that produced it.
--
-- A story has no id of its own, so a row names the issue and the story's
-- position in its stories array, counted from 0, as story_passes does (0007).
-- Re-summarising a newsletter rewrites that array, so digestIssue in
-- lib/news/issues/digest.ts deletes the issue's rows here along with its
-- passes, and the grouping then runs again on the new stories.
--
-- Which story in a group came first is read from the issues' received_at; the
-- group itself has no order and no row of its own.
--
-- The issue is joined by the composite foreign key carrying user_id that
-- 0007 declared the unique key for, so a row cannot name another account's
-- issue.

set search_path = news, public, extensions;

-- The news migrations run after learn's and the vault's when a database is
-- built from the files, so this is already there; it is here so the file does
-- not depend on that order.
create extension if not exists vector with schema extensions;

create table news.story_groups (
  user_id uuid not null references auth.users (id) on delete cascade,
  issue_id uuid not null,
  -- The story's position in the issue's stories array, from 0.
  story_index integer not null,
  -- Shared by every story told about the same event. A story that matched
  -- nothing has a group_id no other row carries.
  group_id uuid not null,
  -- How alike this story was to the one it joined, or null for a story that
  -- started its group.
  similarity real,
  -- What the story was compared by: its headline, a line break, its summary
  -- (repeatText in lib/news/issues/repeats.ts).
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),

  constraint story_groups_pkey primary key (issue_id, story_index),
  constraint story_groups_issue_fk foreign key (issue_id, user_id)
    references news.issues (id, user_id) on delete cascade,
  constraint story_groups_index_ck check (story_index >= 0),
  constraint story_groups_similarity_ck check (similarity is null or similarity between -1 and 1)
);

-- A story's group, and every other story in it.
create index story_groups_group_idx on news.story_groups (user_id, group_id);

-- Row level security, the same owner-only policy as story_passes.
alter table news.story_groups enable row level security;

create policy story_groups_all on news.story_groups for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on news.story_groups from anon;
grant select, insert, update, delete on news.story_groups to authenticated, service_role;

notify pgrst, 'reload schema';
