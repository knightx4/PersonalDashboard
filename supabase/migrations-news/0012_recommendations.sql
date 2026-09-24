-- The free newsletters recommended to you, kept between visits.
--
-- Planned as #946, under #943. The list is made once and changes only when
-- you press Reload, so the page reads it from here and never calls the model
-- on its own. One row per person, replaced whole on every reload: the list is
-- only ever read and written as one piece, so it is held as jsonb rather than
-- a row per newsletter.
--
-- picks is an array of objects, one per newsletter, each with its name,
-- publisher, topic, a one-line reason and a sign-up link. The code that makes
-- the list (lib/news/recommend/) checks that shape; the table only insists on
-- an array.

set search_path = news, public, extensions;

create table news.recommendations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  picks jsonb not null default '[]'::jsonb,
  -- When this list was made, which the page shows beside Reload.
  made_at timestamptz not null default now(),

  constraint recommendations_picks_ck check (jsonb_typeof(picks) = 'array')
);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.recommendations enable row level security;

create policy recommendations_all on news.recommendations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 0001's grants named the tables that existed then, so this one is granted
-- here, and kept from anonymous visitors the same way.
revoke all on news.recommendations from anon;
grant select, insert, update, delete on news.recommendations to authenticated, service_role;

notify pgrst, 'reload schema';
