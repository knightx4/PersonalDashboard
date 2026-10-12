-- Reading posts from X (plan #1819, under #1815).
--
-- The first read pages back through every post X returns for the connected
-- account; after that a daily read asks for posts newer than the last one
-- read and refreshes the numbers on the last thirty days. X charges per post
-- returned, so every request is logged here with how many posts it read, to
-- be checked against X's console.
--
-- public.x_reads, one row per request made to X:
--   run_id        the read the request was part of; one press of Check X now
--                 or one daily run.
--   trigger       daily (the cron), manual (Check X now) or connect (the read
--                 started when the account is connected).
--   kind          history (paging back through old posts), new (posts newer
--                 than the last read) or metrics (refreshing recent numbers).
--   http_status   what X answered; null when the request never got an answer.
--   posts_read    posts X returned, which is what X bills.
--   outcome       ok, rate_limited, out_of_credit or failed.
--   error         X's own words when it refused.
--
-- public.x_accounts gains:
--   read_problem      the one line the Posts tab shows when the last read
--                     stopped (rate limit, no credit, X refused); null when it
--                     finished.
--   read_problem_at   when that read stopped.
--   reading_since     set while a read is going, so a second one does not
--                     start alongside it and spend the same refresh token.
--
-- x_reads is bookkeeping, not a Goals source.

set search_path = public, extensions;

create table public.x_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  run_id uuid not null,
  trigger text not null,
  kind text not null,
  http_status integer,
  posts_read integer not null default 0,
  outcome text not null,
  error text,

  created_at timestamptz not null default now(),

  constraint x_reads_trigger_ck check (trigger in ('daily', 'manual', 'connect')),
  constraint x_reads_kind_ck check (kind in ('history', 'new', 'metrics')),
  constraint x_reads_outcome_ck check (outcome in ('ok', 'rate_limited', 'out_of_credit', 'failed')),
  constraint x_reads_posts_ck check (posts_read >= 0)
);

create index x_reads_user_created_idx on public.x_reads (user_id, created_at desc);

alter table public.x_accounts
  add column read_problem text,
  add column read_problem_at timestamptz,
  add column reading_since timestamptz;

alter table public.x_reads enable row level security;

create policy x_reads_all on public.x_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.x_reads from anon;
grant select, insert, update, delete on public.x_reads to authenticated;
grant all on public.x_reads to service_role;

comment on table public.x_reads is
  'Every request made to X for the connected account, with how many posts it read (plan #1819).';
comment on column public.x_accounts.read_problem is
  'Why the last read of X stopped, as the Posts tab says it; null when it finished (plan #1819).';
comment on column public.x_accounts.reading_since is
  'Set while a read of X is going, so two do not run at once (plan #1819).';
