-- Insights: a question on every card that the person can answer, and a
-- "where I am now" note every run reads first.
--
-- question is the one question a run ends a card with; answer is what the
-- person wrote back on the tab, with answered_at. The next run reads every
-- answer before anything else and builds on it.
--
-- you.now holds one row per person: what is going on for them at the moment
-- (money, what they are focused on, what they have decided against), in
-- their words. A run checks every candidate card against it, so a choice
-- they made on purpose is not read as a gap.
--
-- Schema change only; no existing row is rewritten.

alter table you.insights
  add column if not exists question text,
  add column if not exists answer text,
  add column if not exists answered_at timestamptz;

alter table you.insights drop constraint if exists insights_question_ck;
alter table you.insights
  add constraint insights_question_ck
  check (question is null or (btrim(question) <> '' and char_length(question) <= 300));

alter table you.insights drop constraint if exists insights_answer_ck;
alter table you.insights
  add constraint insights_answer_ck
  check (answer is null or char_length(answer) <= 4000);

comment on column you.insights.question is
  'The one question the run ends the card with, for the person to answer on the tab.';
comment on column you.insights.answer is
  'What the person wrote back to the question; the next run reads it first.';

create table if not exists you.now (
  user_id uuid primary key references auth.users (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table you.now is
  'Where the person is at the moment, in their words: money, focus, what they have decided against. Every insights run reads it first.';

drop trigger if exists now_touch_updated_at on you.now;
create trigger now_touch_updated_at
  before update on you.now
  for each row execute function you.touch_updated_at();

alter table you.now enable row level security;

drop policy if exists now_all on you.now;
create policy now_all on you.now for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.now from anon, authenticated;
grant select, insert, update, delete on you.now to authenticated, service_role;

notify pgrst, 'reload schema';
