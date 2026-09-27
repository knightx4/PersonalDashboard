-- ===========================================================================
-- Claude closes a step of yours when it sees the step happened (plan #1082).
--
-- The morning run looks for evidence against each open step of yours: an
-- application logged in Jobs, an event on your calendar whose day has passed,
-- a confirmation email, a task ticked in Todo. When it finds one it closes
-- the step and says what it saw. Two new columns hold that:
--
--   items.evidence         what Claude saw, in one line the person reads:
--                          "Your application for Finance Manager at Ramp is
--                          in Jobs, sent 12 September."
--   items.evidence_source  where it saw it: 'jobs', 'gmail', 'calendar' or
--                          'todo'. Kept apart from the line so the routine
--                          can count which sources get undone (the goals
--                          skill, "Closing a step from evidence").
--
-- Both are set in the same update as status = 'done', so the history trigger
-- records the close as one row. The run's page and the Goals home read it as
-- "Closed X: <evidence>", and its Undo writes all three columns back.
--
-- What the database holds every writer to:
--
--   - evidence and its source go together, only on a done step;
--   - reopening a step, by hand or by the undo, clears both.
--
-- And Claude in particular: closing one of your steps (mine or rhythm) needs
-- evidence, and the step must have nothing open beneath it. Claude's own
-- steps close on their result as before. A close made by another trigger
-- (a phase whose last sub-step closed, 0040; an information step whose
-- questions are all answered) is left alone: the step that set it off
-- carries the reason.
-- ===========================================================================

alter table goals.items
  add column evidence text,
  add column evidence_source text;

alter table goals.items
  add constraint items_evidence_ck check (
    (evidence is null) = (evidence_source is null)
    and (evidence is null or (
      status = 'done'
      and level = 'step'
      and btrim(evidence) <> ''
      and length(evidence) <= 500
      and evidence_source in ('jobs', 'gmail', 'calendar', 'todo')
    ))
  );

comment on column goals.items.evidence is
  'On a step Claude closed from evidence, what it saw, in one line (plan #1082). Cleared when the step reopens.';
comment on column goals.items.evidence_source is
  'Where the evidence was seen: jobs, gmail, calendar or todo (plan #1082). Set with evidence.';

create or replace function goals.items_evidence_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'done' then
    new.evidence := null;
    new.evidence_source := null;
    return new;
  end if;

  if tg_op <> 'UPDATE'
     or old.status = 'done'
     or old.kind not in ('mine', 'rhythm')
     or pg_trigger_depth() > 1
     or coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;

  if new.evidence is null then
    raise exception 'Claude may close one of your steps only on evidence: set evidence (what you saw) and evidence_source (jobs, gmail, calendar or todo) in the same update.'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from goals.items c
    where c.parent_id = new.id
      and c.user_id = new.user_id
      and c.archived_at is null
      and c.status not in ('done', 'dropped')
  ) then
    raise exception '"%" still has open sub-steps: close them from their own evidence first.', new.title
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_evidence_check() from public, anon, authenticated;

create trigger items_evidence_check before insert or update on goals.items
  for each row execute function goals.items_evidence_check();

notify pgrst, 'reload schema';
