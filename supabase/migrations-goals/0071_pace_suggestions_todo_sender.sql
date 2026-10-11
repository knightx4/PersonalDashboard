-- ===========================================================================
-- Goals without a deadline go at their own pace (plan #1733, step #1734).
--
-- Most goals have no deadline, yet each put a step on Todo and got a daily
-- verdict, so thirteen of sixteen read "Waiting on you". The data now holds
-- what the new reading needs (docs/GOALS-SPEC.md, "Goals without a deadline"):
--
--   reviews.verdict          two more verdicts: pace_holding (the goal's usual
--                            pace is holding) and pace_slipping (slower than
--                            usual).
--   suggestions.kind         a sixth kind, 'step': a suggestion that becomes a
--                            step of the goal when accepted.
--   suggestions.accepted_step_id
--                            the step an accepted 'step' suggestion became.
--   items.on_todo_by         who put a step on Todo: 'me' or 'claude'. Null
--                            when it is not on Todo. Rows already on Todo are
--                            the person's own, so they are set to 'me'.
--   items.on_todo_reason     why Dash put it there, in a sentence. Null for
--                            the person's own.
--
-- on_todo_by and on_todo_reason follow on_todo through a trigger, so the code
-- that sets on_todo alone keeps working: turning it on fills in who (Dash
-- when the request is Dash's, else the person), turning it off clears both.
-- ===========================================================================

alter table goals.reviews drop constraint reviews_verdict_ck;
alter table goals.reviews add constraint reviews_verdict_ck check (
  verdict in ('on_track', 'stalled', 'waiting_on_you', 'waiting_on_date', 'waiting_on_goal', 'met',
              'pace_holding', 'pace_slipping')
);

alter table goals.suggestions drop constraint suggestions_kind_ck;
alter table goals.suggestions add constraint suggestions_kind_ck check (
  kind in ('events', 'volunteering', 'reading', 'courses', 'job_leads', 'step')
);

alter table goals.suggestions add column accepted_step_id uuid;
alter table goals.suggestions add constraint suggestions_accepted_step_fk
  foreign key (accepted_step_id, user_id) references goals.items (id, user_id)
  on delete set null (accepted_step_id);
alter table goals.suggestions add constraint suggestions_accepted_step_ck check (
  accepted_step_id is null or kind = 'step'
);
create index suggestions_accepted_step_idx on goals.suggestions (accepted_step_id)
  where accepted_step_id is not null;

alter table goals.items add column on_todo_by text;
alter table goals.items add column on_todo_reason text;

update goals.items set on_todo_by = 'me' where on_todo;

alter table goals.items add constraint items_on_todo_by_ck check (
  (on_todo_by is null) = (not on_todo) and (on_todo_by is null or on_todo_by in ('me', 'claude'))
);
alter table goals.items add constraint items_on_todo_reason_ck check (
  on_todo_reason is null or (on_todo and length(on_todo_reason) <= 500)
);

create or replace function goals.items_todo_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.on_todo then
    new.on_todo_by := null;
    new.on_todo_reason := null;
  elsif new.on_todo_by is null then
    new.on_todo_by := case
      when coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') = 'claude' then 'claude'
      else 'me'
    end;
  end if;
  return new;
end;
$$;

revoke all on function goals.items_todo_sender() from public, anon, authenticated;

create trigger items_todo_sender before insert or update on goals.items
  for each row execute function goals.items_todo_sender();

comment on column goals.suggestions.accepted_step_id is
  'The step an accepted step suggestion became (plan #1734). Only a suggestion of kind step has one.';
comment on column goals.items.on_todo_by is
  'Who put a step on Todo: me or claude (plan #1734). Null when it is not on Todo; kept in step with on_todo by items_todo_sender.';
comment on column goals.items.on_todo_reason is
  'Why Dash put a step on Todo, in a sentence (plan #1734). Null for a step the person put there.';
comment on column goals.suggestions.kind is
  'The kind of suggestion (plan #1028, #1734): events, volunteering, reading, courses, job_leads, or step, a suggestion that becomes a step of the goal.';
