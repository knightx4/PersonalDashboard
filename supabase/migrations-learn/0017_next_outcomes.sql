-- What came of the things Learn next put in front of you.
--
-- Plan #482, under #477. The page ranks three kinds of row -- a claim you are
-- ready for, a claim worth asking about again, a reading you queued and never
-- opened -- and until now nothing remembered which of them you actually did
-- anything with, so the list came back in the same order however much of it
-- you had worked through. This is the row the ordering in #483 reads.
--
-- Which outcomes count is #479's answer: what you finish, plus a Not now on a
-- row you are pushing aside. Nothing here records that a row was shown, that
-- it was clicked, or how long anybody looked at it. That is the rule the
-- feature was written around and the reason this table is small: three
-- outcomes, each of them something you did on purpose.
--
-- Nothing writes on page render. A row lands when an answer is recorded
-- against a claim, when a reading is marked read, or when you press Not now,
-- which is why `happened_at` is when the thing happened rather than when the
-- page offered it -- the offer itself is not stored anywhere.
--
-- It overlaps learn.probes and learn.readings.status on purpose. Both of those
-- are the evidence for something else -- what you know, where a reading has
-- got to -- and neither has anywhere to put a Not now. One table the ranker
-- reads beats three queries reconstructing the same list.

set search_path = learn, public, extensions;

-- Which of the three kinds of row this was, in the page's own words. The same
-- three values as NextKind in lib/learn/next/rank.ts.
create type learn.next_kind as enum (
  'ready',
  'recheck',
  'reading'
);

-- What you did with it.
create type learn.next_outcome as enum (
  -- A question about the claim, answered.
  'answered',
  -- A reading marked read.
  'read',
  -- Pushed aside. The one signal here that is not finishing something, and it
  -- is you saying so outright rather than the app inferring it.
  'not_now'
);

-- A reading is pointed at by (id, user_id) for the same reason every other
-- link in this schema is: referential integrity bypasses RLS, so a plain
-- foreign key would accept another account's reading and the policy below
-- would never look.
alter table learn.readings add constraint readings_user_id_uq unique (id, user_id);

create table learn.next_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  kind learn.next_kind not null,

  -- Exactly one of these two, decided by the kind. A claim row points at the
  -- claim; a reading row points at the reading.
  concept_id uuid,
  reading_id uuid,

  outcome learn.next_outcome not null,

  -- When you did it. Not when the page offered it: nothing is written at
  -- render time, so there is no offer to date.
  happened_at timestamptz not null default now(),

  constraint next_outcomes_target_ck check (
    case kind
      when 'reading' then reading_id is not null and concept_id is null
      else concept_id is not null and reading_id is null
    end
  ),
  -- Answering is something you do to a claim and reading is something you do
  -- to a reading; only Not now applies to both.
  constraint next_outcomes_outcome_ck check (
    case outcome
      when 'answered' then concept_id is not null
      when 'read' then reading_id is not null
      else true
    end
  ),
  constraint next_outcomes_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint next_outcomes_reading_fk
    foreign key (reading_id, user_id) references learn.readings (id, user_id) on delete cascade
);

-- What the ranking reads: everything this account has done, most recent first.
create index next_outcomes_user_idx on learn.next_outcomes (user_id, happened_at desc);
-- What it has done with one claim or one reading, and the index Postgres does
-- not create for a foreign key.
create index next_outcomes_concept_idx on learn.next_outcomes (concept_id)
  where concept_id is not null;
create index next_outcomes_reading_idx on learn.next_outcomes (reading_id)
  where reading_id is not null;

-- A reading is finished once. Pressing Read it twice is a person clicking
-- again, and the writer leans on this rather than reading the row back first.
create unique index next_outcomes_read_once on learn.next_outcomes (reading_id)
  where outcome = 'read';

comment on table learn.next_outcomes is
  'One row per thing you did with something Learn next offered: a question '
  'answered about a claim, a reading marked read, or a row pushed aside. '
  'Nothing records that a row was shown, opened, or looked at.';

-- ---------------------------------------------------------------------------
-- Row level security. What you have been putting off is as personal as the
-- graph it is about.
-- ---------------------------------------------------------------------------
alter table learn.next_outcomes enable row level security;

create policy next_outcomes_all on learn.next_outcomes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.next_outcomes from anon;

-- Append-only for the app. A record of what you did is not a row the app has
-- any reason to edit, and the account deletion path is the foreign key above
-- rather than a delete from here.
grant select, insert on learn.next_outcomes to authenticated;
grant select, insert, update, delete on learn.next_outcomes to service_role;
