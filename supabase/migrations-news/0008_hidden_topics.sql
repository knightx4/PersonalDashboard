-- The topics you have hidden from Quick read with Fewer like this.
--
-- Planned as #861, under #857. Each Quick read card has a Fewer like this
-- control, and pressing it stops that card's topic from being shown in Quick
-- read from then on. The newsletter list and the issue page still show those
-- stories. News settings lists the hidden topics, and bringing one back
-- deletes its row.
--
-- `topic` is the name as NEWS_TOPICS in lib/news/issues/topics.ts writes it.
-- That list lives in the code and can change without a migration, so it is
-- not copied into a check constraint here. A row naming a topic that has
-- since left the list reads as nothing (readTopic) and hides nothing.

set search_path = news, public, extensions;

create table news.hidden_topics (
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null,
  hidden_at timestamptz not null default now(),

  -- One row per topic. Pressing Fewer like this twice on the same topic is an
  -- upsert onto this key, not a second row.
  constraint hidden_topics_pkey primary key (user_id, topic),
  constraint hidden_topics_topic_ck check (length(btrim(topic)) between 1 and 60)
);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.hidden_topics enable row level security;

create policy hidden_topics_all on news.hidden_topics for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 0001's grants named the tables that existed then, so this one is granted
-- here, and kept from anonymous visitors the same way.
revoke all on news.hidden_topics from anon;
grant select, insert, update, delete on news.hidden_topics to authenticated, service_role;

notify pgrst, 'reload schema';
