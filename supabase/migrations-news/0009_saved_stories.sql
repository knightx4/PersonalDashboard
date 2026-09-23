-- The newsletter stories you have saved to read again.
--
-- Planned as #868, under the Saved feature. #867 chose one Saved list rather
-- than named collections, so there is no collection column: a story is saved
-- or it is not.
--
-- A saved story is a copy, not a pointer. Stories are positions in the jsonb
-- array on news.issues (0005), and re-summarising a newsletter rewrites that
-- array, so a pointer to position 3 would come to name a different story or
-- none. The row therefore keeps what the Saved list shows: the headline,
-- summary, text, link and image as the story carried them, the sender's name
-- and when the newsletter arrived.
--
-- issue_id is kept so the reading page can say whether a story is saved: a
-- story counts as saved when a row for its issue and headline exists, which is
-- the unique key below, and saving it twice is an upsert onto that key. When
-- the newsletter is deleted, issue_id is set to null and the saved copy stays.
--
-- The issue is joined by a composite foreign key carrying user_id, as
-- story_passes does in 0007, so a row cannot name another account's issue.
-- `on delete set null (issue_id)` clears only issue_id, leaving user_id in
-- place; a plain `set null` would null both and fail the not null on user_id.

set search_path = news, public, extensions;

create table news.saved_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The newsletter it was saved from, or null once that has been deleted.
  issue_id uuid,

  headline text not null,
  summary text not null,
  -- The story as the email told it, paragraphs separated by a blank line.
  text text,
  link text,
  image text,

  -- The name the newsletter is listed under: the sender's display name, or
  -- its address when it gave none.
  sender_name text not null,
  -- When the newsletter arrived, copied from news.issues.received_at.
  received_at timestamptz not null,
  saved_at timestamptz not null default now(),

  constraint saved_stories_issue_fk foreign key (issue_id, user_id)
    references news.issues (id, user_id) on delete set null (issue_id),

  constraint saved_stories_headline_ck check (btrim(headline) <> ''),
  constraint saved_stories_summary_ck check (btrim(summary) <> ''),
  constraint saved_stories_text_ck check (text is null or btrim(text) <> ''),
  -- readStories drops any other address before a story reaches the page, and
  -- this keeps the copy to the same rule.
  constraint saved_stories_link_ck check (link is null or link ~* '^https?://'),
  constraint saved_stories_image_ck check (image is null or image ~* '^https?://'),
  constraint saved_stories_sender_name_ck check (btrim(sender_name) <> '')
);

-- One save per story. Nulls are distinct, so copies whose newsletter has been
-- deleted never collide with each other.
create unique index saved_stories_user_issue_headline_key
  on news.saved_stories (user_id, issue_id, headline);

-- The Saved list: newest save first.
create index saved_stories_user_saved_idx on news.saved_stories (user_id, saved_at desc);

-- The foreign key index Postgres does not create for you, which the set null
-- on deleting an issue looks up.
create index saved_stories_issue_idx on news.saved_stories (issue_id) where issue_id is not null;

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.saved_stories enable row level security;

create policy saved_stories_all on news.saved_stories for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 0001's grants named the tables that existed then, so this one is granted
-- here, and kept from anonymous visitors the same way.
revoke all on news.saved_stories from anon;
grant select, insert, update, delete on news.saved_stories to authenticated, service_role;

notify pgrst, 'reload schema';
