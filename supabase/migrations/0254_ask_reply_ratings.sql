-- Thumbs on Dash's answers, and the result of each week's check (plan #2285.1).
--
-- A thumbs up or down is kept on Dash's own turn in core.conversation_turns:
--
--   rating       'up' or 'down'. Only an assistant turn can carry one.
--   rating_note  what was wrong or right, in their words, up to 1000 characters.
--                Only a rated turn has one.
--   rated_at     when it was rated; set exactly when rating is.
--
-- Once a week a cheap check reads the week's Ask Dash chats for replies they
-- pushed back on, repeated themselves over or gave up on. core.ask_reply_checks
-- is one row per account per week saying it ran and what it flagged:
--
--   week         the Monday of the week checked.
--   checked_at   when the check ran.
--   model        the model that read the chats.
--   flagged      a jsonb array of { turn_id, conversation_id, kind, quote }.
--   note_id      the feedback_items row (the Dev note) it wrote, null when the
--                week had nothing to flag.
--
-- Schema only: no rows are changed.

set search_path = core, public, extensions;

alter table core.conversation_turns
  add column rating text,
  add column rating_note text,
  add column rated_at timestamptz;

alter table core.conversation_turns
  add constraint conversation_turns_rating_ck check (rating is null or rating in ('up', 'down')),
  add constraint conversation_turns_rating_role_ck check (rating is null or role = 'assistant'),
  add constraint conversation_turns_rated_at_ck check ((rating is null) = (rated_at is null)),
  add constraint conversation_turns_rating_note_ck check (
    rating_note is null or (rating is not null and char_length(rating_note) <= 1000)
  );

comment on column core.conversation_turns.rating is
  'Their thumbs on one of Dash''s answers: up or down. Null when unrated (plan #2285).';

create table core.ask_reply_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  week date not null,
  checked_at timestamptz not null default clock_timestamp(),
  model text not null,
  flagged jsonb not null default '[]'::jsonb,
  note_id uuid,

  constraint ask_reply_checks_week_uq unique (user_id, week),
  constraint ask_reply_checks_monday_ck check (extract(isodow from week) = 1),
  constraint ask_reply_checks_flagged_ck check (jsonb_typeof(flagged) = 'array')
);

alter table core.ask_reply_checks enable row level security;

create policy ask_reply_checks_all on core.ask_reply_checks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.ask_reply_checks from anon;
grant select, insert, update, delete on core.ask_reply_checks to authenticated, service_role;

comment on table core.ask_reply_checks is
  'One row per account per week: the check of Ask Dash replies that went badly, what it flagged and the Dev note it wrote (plan #2285).';
