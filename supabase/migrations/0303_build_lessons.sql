-- What building this app keeps running into, and what was done about it.
--
-- Builders hit the same walls over and over: on 5 November 2026 six runs went
-- into re-recording design critic rounds for #2879 because `plan.ts built`
-- had recorded another step's commit, and in the two weeks before it 18 runs
-- failed on the same close guard. Each run's stop line said so, and nothing
-- read them side by side. These tables are where that is counted.
--
--   build_friction   one thing that cost a builder time: a guard that refused,
--                    a gate check that failed, a tool that broke, a doc that
--                    misled, a mistake made again. Written by sessions
--                    (`npm run friction -- log`), by the tools themselves when
--                    they refuse (plan.ts, the gate, the writing check), and by
--                    the daily review from failed runs' stop lines.
--   build_lessons    the cause behind a group of friction rows, under a short
--                    key. A lesson is open until a review removes the cause in
--                    code (fixed) or, where code cannot, writes what a builder
--                    should do instead (taught). Taught and open lessons are
--                    printed to every builder when it claims a step. Friction
--                    filed against a fixed lesson reopens it as regressed.
--   build_reviews    one row per run of the daily review, so the next knows
--                    where the last stopped.
--
-- New tables only; no existing row is read or changed.

set search_path = public, extensions;

create table if not exists build_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  title text not null,
  lesson text,
  status text not null default 'open',
  fix text,
  fixed_at timestamptz,
  regressed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint build_lessons_key_ck check (key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint build_lessons_title_ck check (length(btrim(title)) between 1 and 200),
  constraint build_lessons_lesson_ck check (lesson is null or length(lesson) <= 1200),
  constraint build_lessons_status_ck check (status in ('open', 'taught', 'fixed', 'wont_fix')),
  constraint build_lessons_fix_ck check (fix is null or length(fix) <= 600),
  constraint build_lessons_fixed_ck check (status <> 'fixed' or (fix is not null and fixed_at is not null))
);

create unique index if not exists build_lessons_key_key on build_lessons (user_id, key);

create table if not exists build_friction (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id uuid references build_lessons (id) on delete set null,
  plan_item_id uuid references plan_items (id) on delete set null,
  run_id uuid references plan_runs (id) on delete set null,
  kind text not null,
  what text not null,
  cost_minutes integer,
  source text not null default 'session',
  created_at timestamptz not null default now(),
  constraint build_friction_kind_ck
    check (kind in ('guard', 'gate', 'tool', 'mistake', 'misled', 'slow', 'stop', 'critic', 'writing')),
  constraint build_friction_what_ck check (length(btrim(what)) between 1 and 600),
  constraint build_friction_cost_ck check (cost_minutes is null or cost_minutes between 0 and 600),
  constraint build_friction_source_ck check (source in ('session', 'tool', 'review'))
);

create index if not exists build_friction_user_created_idx on build_friction (user_id, created_at desc);
create index if not exists build_friction_lesson_idx on build_friction (lesson_id);
-- A failed run's stop line is read into one friction row, once.
create unique index if not exists build_friction_stop_run_key
  on build_friction (run_id) where kind = 'stop';

create table if not exists build_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note text not null,
  fixed text[] not null default '{}',
  taught text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint build_reviews_note_ck check (length(btrim(note)) between 1 and 2000)
);

create index if not exists build_reviews_user_created_idx on build_reviews (user_id, created_at desc);

alter table build_lessons enable row level security;
alter table build_friction enable row level security;
alter table build_reviews enable row level security;

create policy build_lessons_owner on build_lessons for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy build_friction_owner on build_friction for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy build_reviews_owner on build_reviews for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on build_lessons, build_friction, build_reviews to authenticated;
revoke all on table build_lessons, build_friction, build_reviews from anon;

comment on table build_lessons is
  'A cause builders keep running into, under a short key: open, taught (lesson written for builders), fixed (removed in code), or wont_fix (migration 0303).';
comment on table build_friction is
  'One thing that cost a builder time: a refusal, a failed gate check, a broken tool, a misleading doc, a repeated mistake, a failed run (migration 0303).';
comment on table build_reviews is
  'One run of the daily builder review: what it fixed and what it taught (migration 0303).';
