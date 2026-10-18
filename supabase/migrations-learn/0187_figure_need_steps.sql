-- The plan step written for a figure lessons keep asking for (plan #2321.10).
--
--   learn.figure_need_steps
--       One row per grouped need that has a plan step: key is the group's
--       key in learn.figure_needs, plan_item_id the step the daily cron
--       wrote for it under plan #2321 (lib/learn/figures/need-steps.ts).
--       asked is how many lessons had asked when the step was written; the
--       count as it stands is the group's in learn.figure_need_groups. A
--       group with a row here is never filed again, so a later request for
--       the same figure adds to the count rather than a second step.
--
--   learn.figure_need_groups
--       Gains plan_item_id, the group's step or null while it has none.
--
-- Bookkeeping, not a source.

set search_path = learn, public, extensions;

create table if not exists learn.figure_need_steps (
  user_id uuid not null references auth.users (id) on delete cascade,
  key uuid not null,
  plan_item_id uuid not null references public.plan_items (id) on delete cascade,
  asked integer not null check (asked >= 1),
  created_at timestamptz not null default now(),
  primary key (user_id, key),
  constraint figure_need_steps_plan_item_key unique (plan_item_id)
);

comment on table learn.figure_need_steps is
  'The plan step written for each grouped figure need, so a group is filed once (plan #2321.10).';

alter table learn.figure_need_steps enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'figure_need_steps' and policyname = 'figure_need_steps_read'
  ) then
    create policy figure_need_steps_read on learn.figure_need_steps for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

grant select on learn.figure_need_steps to authenticated;
grant select, insert, update, delete on learn.figure_need_steps to service_role;
revoke all on table learn.figure_need_steps from anon;

create or replace view learn.figure_need_groups
with (security_invoker = on) as
select
  n.user_id,
  n.key,
  first.need,
  first.shows,
  first.why,
  first.caption,
  count(*)::integer as asked,
  array_agg(distinct n.card_id) as card_ids,
  array_agg(distinct n.subject_id) filter (where n.subject_id is not null) as subject_ids,
  min(n.created_at) as first_asked_at,
  max(n.created_at) as last_asked_at,
  step.plan_item_id
from learn.figure_needs n
join learn.figure_needs first on first.id = n.key
left join learn.figure_need_steps step on step.user_id = n.user_id and step.key = n.key
group by n.user_id, n.key, first.need, first.shows, first.why, first.caption, step.plan_item_id;

comment on view learn.figure_need_groups is
  'One row per grouped figure need, with how many lessons asked and the plan step written for it (plans #2321.9, #2321.10).';

grant select on learn.figure_need_groups to authenticated, service_role;
revoke all on learn.figure_need_groups from anon;
