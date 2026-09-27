-- ===========================================================================
-- Proposing to close or park a goal (plan #1084).
--
-- Two proposals reach Today on the Goals home, each with one button, and
-- both leave the move with the person: the guard (0006, restated in 0051)
-- already refuses Claude any change to a goal's status.
--
-- Close. When the morning run reads a goal's done-when as met, its verdict
-- for the day is `met`, and the reason is a short summary of how the goal
-- got there. Today offers to close the goal on the newest such verdict.
--
-- Park. A goal with nothing done in three weeks (STALLED_AFTER_DAYS in
-- lib/goals/reviews.ts) is offered for parking. A parked goal is set aside
-- to come back to: it keeps its steps, leaves the home and the runs, and
-- is taken back up from All goals. Only a goal can be parked, and parking
-- is not a close, so it carries no closed_at.
--
-- Keep it open. Saying no to either proposal writes items.kept_open_at, and
-- so does taking a goal back up. A close proposal older than it is not
-- shown, and the three weeks for a park proposal count from it. Only you
-- write it.
-- ===========================================================================

alter table goals.items drop constraint items_status_ck;
alter table goals.items add constraint items_status_ck check (
  status in ('proposed', 'open', 'blocked', 'parked', 'done', 'dropped')
);
alter table goals.items add constraint items_parked_goal_ck check (
  status <> 'parked' or level = 'goal'
);

alter table goals.items add column kept_open_at timestamptz;
alter table goals.items add constraint items_kept_open_goal_ck check (
  kept_open_at is null or level = 'goal'
);

comment on column goals.items.kept_open_at is
  'On a goal, when you last kept it open against a proposal to close or park it, or took it back up (plan #1084). Written by you only.';

create or replace function goals.items_kept_open_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.kept_open_at is not null)
     or (tg_op = 'UPDATE' and new.kept_open_at is distinct from old.kept_open_at) then
    raise exception 'Claude may not keep a goal open for you: only you answer a proposal to close or park it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_kept_open_guard() from public, anon, authenticated;

create trigger items_kept_open_guard before insert or update on goals.items
  for each row execute function goals.items_kept_open_guard();

alter table goals.reviews drop constraint reviews_verdict_ck;
alter table goals.reviews add constraint reviews_verdict_ck check (
  verdict in ('on_track', 'stalled', 'waiting_on_you', 'waiting_on_date', 'waiting_on_goal', 'met')
);

comment on table goals.reviews is
  'The daily run''s status on each open goal (plans #1018, #1074, #1084): on track, stalled, waiting on you, waiting on a date, waiting on another goal, or its done-when met, with why, the next move and its date. The newest per goal is the goal''s status; a met verdict is a proposal to close the goal, and its reason is the summary of how it got there.';

notify pgrst, 'reload schema';
