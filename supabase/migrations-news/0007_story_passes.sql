-- Which newsletter stories you have moved past in Quick read.
--
-- Planned as #849, under #845. Quick read shows one story at a time and never
-- shows the same one twice, so each story you move past is recorded here.
-- #847 chose one Next button, so a pass records only that you went past the
-- story and when. It does not say whether you read it, and there is no outcome
-- column.
--
-- A story has no id of its own. Stories are the jsonb array on news.issues
-- (0005), so a pass names the issue and the story's position in that array,
-- counted from 0. A newsletter that is one essay has an empty array and is
-- shown as a single card; passing that card is recorded as position 0.
--
-- Re-summarising a newsletter rewrites its array, and a position then names a
-- different story. digestIssue in lib/news/issues/digest.ts deletes an issue's
-- passes when it saves a new summary over an old one, so a redo shows the
-- newsletter's stories again rather than skipping ones that were never seen.
--
-- The issue is joined by a composite foreign key carrying user_id, as issues
-- join senders in 0001: foreign keys bypass row level security, so a plain
-- `references news.issues (id)` would accept another account's issue. That
-- needs (id, user_id) to be unique on issues, which it is trivially since id
-- is the primary key; the constraint below only declares it.

set search_path = news, public, extensions;

alter table news.issues
  add constraint issues_id_user_key unique (id, user_id);

create table news.story_passes (
  user_id uuid not null references auth.users (id) on delete cascade,
  issue_id uuid not null,
  -- The story's position in the issue's stories array, from 0.
  story_index integer not null,
  passed_at timestamptz not null default now(),

  -- One record per story. Pressing Next twice on the same card is an upsert
  -- onto this key, not a second row.
  constraint story_passes_pkey primary key (issue_id, story_index),
  constraint story_passes_issue_fk foreign key (issue_id, user_id)
    references news.issues (id, user_id) on delete cascade,
  constraint story_passes_index_ck check (story_index >= 0)
);

-- Quick read loads every pass for the account at once.
create index story_passes_user_idx on news.story_passes (user_id);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.story_passes enable row level security;

create policy story_passes_all on news.story_passes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 0001's grants named the tables that existed then, so this one is granted
-- here, and kept from anonymous visitors the same way.
revoke all on news.story_passes from anon;
grant select, insert, update, delete on news.story_passes to authenticated, service_role;

notify pgrst, 'reload schema';
