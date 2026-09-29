-- ===========================================================================
-- The app holds a Claude step that acts outside the plan (plan #1183).
--
-- 0042 made a step with an `acts` sentence wait for the person, but only when
-- Dash notices that the step acts and writes the sentence itself. Before a
-- goals run starts, and when a step is sent, the app now asks Jev whether
-- each open Claude step with no sentence sends, submits, books, buys, shares
-- or changes records elsewhere (lib/goals/hold-acts-store.ts). A step it
-- holds goes back to `proposed` with a sentence Haiku wrote, and then waits
-- on Approve like any step Dash proposed.
--
-- items_acts_guard refuses a write that says it is Claude's from adding
-- `acts` to a live step, and the morning run's service client says it is
-- Claude's. So the hold goes through this function, which marks its own
-- write as the app's (`goals.actor` = 'app') for the rest of the call. The
-- history trigger does not know 'app' and records the change as it would
-- without a header: 'claude' for the service role, 'me' for a signed-in call.
--
-- Security invoker, so a signed-in caller can hold only their own steps
-- (RLS), and the service role, which bypasses RLS, is the caller's to narrow
-- by user. It holds only what a run could work: an open Claude step, or one
-- blocked on other steps (whose block clears itself; the dependency rows stay).
-- A step blocked on the person, closed, archived or already carrying a
-- sentence is left alone. True when it held the step.
-- ===========================================================================

create or replace function goals.hold_acting_step(step uuid, sentence text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  held integer;
begin
  if sentence is null or length(btrim(sentence)) not between 1 and 500 then
    raise exception 'A held step needs one sentence of 1 to 500 characters saying what it does.'
      using errcode = 'check_violation';
  end if;

  perform set_config('goals.actor', 'app', true);

  update goals.items
  set status = 'proposed',
      acts = btrim(sentence)
  where id = step
    and level = 'step'
    and kind = 'claude'
    and acts is null
    and archived_at is null
    and (status = 'open' or (status = 'blocked' and block_kind = 'steps'));
  get diagnostics held = row_count;

  perform set_config('goals.actor', '', true);
  return held > 0;
end;
$$;

revoke all on function goals.hold_acting_step(uuid, text) from public, anon;
grant execute on function goals.hold_acting_step(uuid, text) to authenticated, service_role;

comment on function goals.hold_acting_step(uuid, text) is
  'Plan #1183: turn an open Claude step with no acts sentence into a proposal carrying one, as the app rather than Claude. True when it held the step.';
