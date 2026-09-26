-- Thumbs up and thumbs down on a Quick read card.
--
-- The two buttons take the place of Fewer like this on the card. For now a
-- reaction is only recorded: nothing reads it to rank or hide stories yet. It
-- is kept so the ranking in lib/news/quick/rank.ts can learn from it later.
--
-- A story is a position in the stories array on news.issues (0005), and
-- re-summarising a newsletter rewrites that array. So the row keeps a copy of
-- what the reaction was about, the headline and topic as the card showed
-- them, and the sender, rather than trusting story_index alone. story_index
-- is 0 for a newsletter that is one essay, as it is in story_passes (0007).
--
-- One reaction per story: pressing the other thumb changes it, and pressing
-- the same one again deletes the row.
--
-- The issue is joined by the composite foreign key story_passes uses, so a
-- row cannot name another account's issue. Deleting the newsletter deletes its
-- reactions, as it does its passes.

set search_path = news, public, extensions;

create table news.story_reactions (
  user_id uuid not null references auth.users (id) on delete cascade,
  issue_id uuid not null,
  story_index int not null,
  reaction text not null,

  -- What the card showed, copied at the time of the press.
  headline text not null,
  topic text,
  sender_id uuid,

  reacted_at timestamptz not null default now(),

  primary key (user_id, issue_id, story_index),

  constraint story_reactions_issue_fk foreign key (issue_id, user_id)
    references news.issues (id, user_id) on delete cascade,

  constraint story_reactions_reaction_ck check (reaction in ('up', 'down')),
  constraint story_reactions_index_ck check (story_index >= 0),
  constraint story_reactions_headline_ck check (btrim(headline) <> '')
);

-- The foreign key index Postgres does not create for you, and the one the
-- page reads a newsletter's reactions by.
create index story_reactions_issue_idx on news.story_reactions (issue_id);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.story_reactions enable row level security;

create policy story_reactions_all on news.story_reactions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on news.story_reactions from anon;
grant select, insert, update, delete on news.story_reactions to authenticated, service_role;

notify pgrst, 'reload schema';
