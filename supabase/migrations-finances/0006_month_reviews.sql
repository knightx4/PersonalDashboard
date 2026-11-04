-- The monthly money review (plan #2593.8.2).
--
-- On the first of each month Dash writes a short review of the month before:
-- spending by category against the three months before it, subscriptions
-- that started or changed price, unusual charges, interest charged on cards
-- and loans, card and loan payments coming due, and how net worth moved.
--
-- The figures are worked out in code (lib/finances/review/facts.ts), through
-- the same rules the Finances pages use, and the model only words them. Each
-- line keeps the ids of the transactions behind it, so the page can open
-- them; a line about a balance, such as net worth or a payment due, has no
-- transaction behind it and keeps its accounts instead.
--
-- One row per person per month. A run that fails is kept with status
-- 'failed' and the error, so the page can offer Try again, and the daily cron
-- tries it again on its own a few times.

set search_path = finances, public, extensions;

create table finances.month_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The first day of the month reviewed.
  month date not null,

  -- written: the review is there to show. failed: the run broke; error says
  -- how, and lines hold whatever the code had worked out before it did.
  status text not null,
  -- model: Dash worded it. plain: the code's own sentences, when there was
  -- nothing to word, no key, or the wording failed its checks.
  source text,
  model text,

  -- One or two sentences that open the review.
  summary text,
  -- [{id, kind, text, transaction_ids: uuid[], account_ids: uuid[]}], in the
  -- order the page shows them.
  lines jsonb not null default '[]'::jsonb,
  -- The figures the lines were written from, for checking a line against.
  facts jsonb not null default '{}'::jsonb,

  error text,
  -- How many runs have tried this month: the cron stops retrying a failed
  -- one after three.
  attempts integer not null default 1,
  written_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint month_reviews_month_ck check (extract(day from month) = 1),
  constraint month_reviews_status_ck check (status in ('written', 'failed')),
  constraint month_reviews_source_ck check (source is null or source in ('model', 'plain')),
  constraint month_reviews_written_ck check (status <> 'written' or (source is not null and written_at is not null)),
  constraint month_reviews_lines_ck check (jsonb_typeof(lines) = 'array'),
  constraint month_reviews_attempts_ck check (attempts >= 1),
  constraint month_reviews_user_month_key unique (user_id, month)
);

create index month_reviews_user_month_idx on finances.month_reviews (user_id, month desc);

create trigger month_reviews_touch_updated_at before update on finances.month_reviews
  for each row execute function finances.touch_updated_at();

alter table finances.month_reviews enable row level security;

-- The person reads their own reviews; only the server writes them, since a
-- write spends on a model call.
create policy month_reviews_select on finances.month_reviews for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on finances.month_reviews from anon, authenticated;
grant select on finances.month_reviews to authenticated;
grant select, insert, update, delete on finances.month_reviews to service_role;
