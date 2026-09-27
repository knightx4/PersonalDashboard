-- ===========================================================================
-- One timeline of what you did, across the modules (plan #1117).
--
-- Feature #1116 notices patterns that cross modules: buying more the week
-- after a rejection, the vault going quiet while interviews pick up. Each
-- module keeps its own history, so there was no single list to read those
-- from. core.timeline is that list: one row per thing you did, read from the
-- rows the modules already hold. Nothing new is recorded.
--
-- A view rather than a table, so there is nothing to keep in step with the
-- modules. security_invoker, so it is read with the caller's own RLS on every
-- table beneath it: you see your own events and nobody else's. If it proves
-- slow, materialise it then.
--
-- It lives in core because it belongs to no one module, and the file sits in
-- migrations-goals because goals is the last folder applied
-- (scripts/db-reset.sh): the view reads from every module's schema, so it
-- has to come after all of them.
--
-- Columns
--
--   user_id        whose event it is
--   occurred_at    when it happened. Orders and returns carry a date only;
--                  those are placed at noon in the account's time zone
--                  (core.account_settings.timezone, or UTC when that is
--                  not a zone Postgres knows), so the day does not shift
--                  when the page groups by local day.
--   module         the app's module id (lib/modules.ts)
--   kind           what happened, one of the list below
--   title          the thing it happened to, as a list names it
--   detail         a short second line, or null
--   amount_cents   money moved, for orders and refunds; null otherwise
--   currency       the currency of amount_cents
--   source_table   `schema.table` of the row that records the event
--   source_id      that row's id: the evidence ref a later step cites
--   link_ref       the id a link to the event is built from (a role, a
--                  concept, a goal, a note's path); lib/timeline/timeline.ts
--                  turns it into a page
--
-- Kinds, by module
--
--   shopping  ordered            public.orders, not cancelled or deleted
--             returned           public.returns, not denied
--   jobs      applied            job_search.application_events 'submitted'
--             rejected           ... 'rejection', detail the stage reached
--             offer              ... 'offer'
--             withdrew           ... 'withdrawal'
--             interviewed        job_search.interviews held: past, and not
--                                cancelled or rescheduled
--   todo      task_done          todo.tasks done
--   vault     note_written       obsidian.notes that reached the app after
--                                the first sync finished. The first sync
--                                brings in the vault's past (1,215 notes
--                                stamped on 2 and 3 September 2026), which
--                                is not writing done that day.
--   learn     probe_answered     learn.probes answered, not discarded
--             placement_answered learn.opening_questions answered
--             quiz_answered      learn.quiz_questions answered
--             reading_finished   learn.readings finished
--   goals     step_done          goals.items steps closed as done
--             goal_done          goals.items goals closed as done
-- ===========================================================================

set search_path = core, public, extensions;

-- core.account_settings.timezone takes any string (0040), and a zone Postgres
-- does not know would fail the whole read, so an unknown one reads as UTC.
-- Checked by trying it rather than by joining pg_timezone_names, which builds
-- all 1,196 names on every read and took 0.8 seconds of a 0.8-second read.
create or replace function core.time_zone_or_utc(zone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone zone;
  return zone;
exception when others then
  return 'UTC';
end;
$$;

revoke all on function core.time_zone_or_utc(text) from public, anon;
grant execute on function core.time_zone_or_utc(text) to authenticated, service_role;

create or replace view core.timeline with (security_invoker = true) as
with
  zone as (
    select s.user_id, core.time_zone_or_utc(s.timezone) as tz
    from core.account_settings s
  ),
  goal_of as (
    -- Each goal item with the goal it sits under, however deep.
    with recursive up as (
      select g.id, g.id as goal_id, g.title as goal_title
      from goals.items g
      where g.level = 'goal'
      union all
      select c.id, up.goal_id, up.goal_title
      from goals.items c
      join up on c.parent_id = up.id
      where c.level = 'step'
    )
    select id, goal_id, goal_title from up
  )

-- Shopping ------------------------------------------------------------------
select
  o.user_id,
  (o.order_date + time '12:00') at time zone coalesce(z.tz, 'UTC') as occurred_at,
  'shopping'::text as module,
  'ordered'::text as kind,
  coalesce(m.name, 'An order') as title,
  o.external_order_number as detail,
  o.total_cents as amount_cents,
  o.currency,
  'public.orders'::text as source_table,
  o.id::text as source_id,
  o.id::text as link_ref
from public.orders o
left join public.merchants m on m.id = o.merchant_id
left join zone z on z.user_id = o.user_id
where o.deleted_at is null
  and o.cancelled_at is null
  and o.status <> 'cancelled'

union all
select
  r.user_id,
  (r.initiated_at + time '12:00') at time zone coalesce(z.tz, 'UTC'),
  'shopping',
  'returned',
  coalesce(m.name, 'A return'),
  r.status::text,
  r.refund_amount_cents,
  o.currency,
  'public.returns',
  r.id::text,
  r.id::text
from public.returns r
join public.orders o on o.id = r.order_id
left join public.merchants m on m.id = o.merchant_id
left join zone z on z.user_id = r.user_id
where r.status <> 'denied'

-- Jobs ----------------------------------------------------------------------
union all
select
  e.user_id,
  e.occurred_at,
  'jobs',
  case e.kind
    when 'submitted' then 'applied'
    when 'rejection' then 'rejected'
    when 'offer' then 'offer'
    when 'withdrawal' then 'withdrew'
  end,
  ro.title || coalesce(' at ' || co.name, ''),
  case
    when e.kind = 'rejection' then
      nullif(replace(coalesce(a.rejection_stage_override, a.rejection_stage)::text, '_', ' '), 'unknown')
  end,
  null::integer,
  null::text,
  'job_search.application_events',
  e.id::text,
  ro.id::text
from job_search.application_events e
join job_search.applications a on a.id = e.application_id
join job_search.roles ro on ro.id = a.role_id
left join job_search.companies co on co.id = ro.company_id
where e.kind in ('submitted', 'rejection', 'offer', 'withdrawal')

union all
select
  i.user_id,
  i.scheduled_at,
  'jobs',
  'interviewed',
  ro.title || coalesce(' at ' || co.name, ''),
  replace(i.kind::text, '_', ' '),
  null,
  null,
  'job_search.interviews',
  i.id::text,
  ro.id::text
from job_search.interviews i
join job_search.applications a on a.id = i.application_id
join job_search.roles ro on ro.id = a.role_id
left join job_search.companies co on co.id = ro.company_id
where i.scheduled_at <= now()
  and i.status not in ('cancelled', 'rescheduled')

-- Todo ----------------------------------------------------------------------
union all
select
  t.user_id,
  t.completed_at,
  'todo',
  'task_done',
  t.title,
  null,
  null,
  null,
  'todo.tasks',
  t.id::text,
  t.id::text
from todo.tasks t
where t.status = 'done' and t.completed_at is not null

-- Vault ---------------------------------------------------------------------
union all
select
  n.user_id,
  n.created_at,
  'vault',
  'note_written',
  n.title,
  null,
  null,
  null,
  'obsidian.notes',
  n.id::text,
  n.path
from obsidian.notes n
left join obsidian.vault_connections c on c.id = n.connection_id
where n.deleted_at is null
  and (c.backfill_completed_at is null or n.created_at > c.backfill_completed_at)

-- Learn ---------------------------------------------------------------------
union all
select
  p.user_id,
  p.answered_at,
  'learn',
  'probe_answered',
  c.name,
  case
    when p.dont_know then 'did not know'
    when p.response_correct or p.chosen_index = p.correct_index then 'right'
    when p.response_correct = false or p.chosen_index is not null then 'wrong'
  end,
  null,
  null,
  'learn.probes',
  p.id::text,
  p.concept_id::text
from learn.probes p
join learn.concepts c on c.id = p.concept_id
where p.answered_at is not null and p.discarded_at is null

union all
select
  q.user_id,
  q.answered_at,
  'learn',
  'placement_answered',
  s.subject_name,
  q.claim_name,
  null,
  null,
  'learn.opening_questions',
  q.id::text,
  s.subject_id::text
from learn.opening_questions q
join learn.opening_sweeps s on s.id = q.sweep_id
where q.answered_at is not null

union all
select
  q.user_id,
  q.answered_at,
  'learn',
  'quiz_answered',
  z.title,
  q.outcome::text,
  null,
  null,
  'learn.quiz_questions',
  q.id::text,
  q.quiz_id::text
from learn.quiz_questions q
join learn.quizzes z on z.id = q.quiz_id
where q.answered_at is not null

union all
select
  r.user_id,
  r.finished_at,
  'learn',
  'reading_finished',
  coalesce(r.title, r.locator_label, 'A reading'),
  null,
  null,
  null,
  'learn.readings',
  r.id::text,
  r.id::text
from learn.readings r
where r.finished_at is not null

-- Goals ---------------------------------------------------------------------
union all
select
  i.user_id,
  i.closed_at,
  'goals',
  case i.level when 'goal' then 'goal_done' else 'step_done' end,
  i.title,
  case when i.level = 'step' then g.goal_title end,
  null,
  null,
  'goals.items',
  i.id::text,
  g.goal_id::text
from goals.items i
left join goal_of g on g.id = i.id
where i.status = 'done' and i.closed_at is not null
  and i.level in ('goal', 'step');

comment on view core.timeline is
  'One row per thing you did across the modules, read from the rows they already hold (plan #1117). Read it ordered by occurred_at.';

revoke all on core.timeline from public, anon;
grant select on core.timeline to authenticated, service_role;
