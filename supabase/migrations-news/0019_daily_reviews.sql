-- One daily review for each day (plan #1613, under #1612).
--
-- Each evening Dash writes a review of the day: a short overview, then the
-- day's most important stories in one line each. The review is kept, so it
-- reads the same tomorrow and earlier days can be opened again. One row per
-- person per day, where day is the date in the person's timezone that the
-- review covers. The cron that writes it (#1615) upserts on (user_id, day),
-- so a second run on the same day replaces the first rather than adding one.
--
-- items is an array of objects in the order the review shows them, each with
-- issue_id, story_index, headline, line (its one line) and sources (how many
-- newsletters ran it), plus local: true on the one local story. A story is a
-- position in news.issues.stories, and re-summarising a newsletter rewrites
-- that array, so the headline and line are copied here rather than read back
-- through story_index (the same reasoning as story_reactions in 0015). The
-- code that writes the items checks that shape; the table only insists on an
-- array.
--
-- error holds why a run failed, so the tab can say so instead of showing an
-- empty day. A row has an overview or an error. Model spend is recorded in
-- core.model_spend under the run's own label, so no cost is kept here.

set search_path = news, public, extensions;

create table news.daily_reviews (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  overview text,
  items jsonb not null default '[]'::jsonb,
  written_at timestamptz not null default now(),
  error text,

  primary key (user_id, day),

  constraint daily_reviews_items_ck check (jsonb_typeof(items) = 'array'),
  constraint daily_reviews_written_ck check (
    nullif(btrim(overview), '') is not null or nullif(btrim(error), '') is not null
  )
);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.daily_reviews enable row level security;

create policy daily_reviews_all on news.daily_reviews for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on news.daily_reviews from anon;
grant select, insert, update, delete on news.daily_reviews to authenticated, service_role;

notify pgrst, 'reload schema';
