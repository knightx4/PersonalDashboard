-- Which lit topics have had a document pulled for them (plan #2247.11).
--
-- A few documents a day are pulled for the Level 4 topics that just lit, so the
-- store of structure documents grows a little ahead of need. This table is the
-- run's memory: a topic is pulled once, and the rows of one day are the count
-- against the budget of five pulls a day.
--
--   topic_id    the Level 4 topic (learn.area_check_articles) that lit
--   pulled_on   the UTC day of the attempt
--   kind        the goal kind the topic was classified as
--   provider    the provider that ran, null when none had code
--   outcome     stored (a document now covers it), nothing (the provider found
--               none it could confirm) or failed (a call or fetch failed; the
--               topic is tried again on a later day)
--   item_id     the first catalogue item stored, if any

set search_path = learn, public, extensions;

create table if not exists learn.topic_structure_pulls (
  user_id uuid not null references auth.users (id) on delete cascade,
  topic_id uuid not null references learn.area_check_articles (id) on delete cascade,
  pulled_on date not null,
  kind text,
  provider text,
  outcome text not null,
  item_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id),
  constraint topic_structure_pulls_outcome_ck check (outcome in ('stored', 'nothing', 'failed'))
);

create index if not exists topic_structure_pulls_day_idx
  on learn.topic_structure_pulls (user_id, pulled_on);

alter table learn.topic_structure_pulls enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'topic_structure_pulls' and policyname = 'topic_structure_pulls_read'
  ) then
    create policy topic_structure_pulls_read on learn.topic_structure_pulls for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

-- The daily run writes it; the person may read it.
revoke all on learn.topic_structure_pulls from anon, authenticated;
grant select on learn.topic_structure_pulls to authenticated;
grant select, insert, update, delete on learn.topic_structure_pulls to service_role;

comment on table learn.topic_structure_pulls is
  'Bookkeeping for the daily pull of one structure document per newly lit Level 4 topic (plan #2247.11); the rows of a day count against its budget of five.';
