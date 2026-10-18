-- A figure need is served once a lesson shows the real figure (plan #2321.11).
--
--   learn.figure_needs
--       Gains served_kind and served_at, set when the daily backfill replaced
--       the lesson's wanted block with a figure of that kind; unserved_reason
--       and tried_at, set when the writer tried and could not fill the block
--       (the data is not in the source), so the lesson keeps its caption and
--       the next try waits a few days.
--
--   learn.figure_need_groups
--       Counts only the rows not yet served, so a group whose lessons all
--       have their figure leaves the subject page's not-built list, and
--       carries unserved_reason, the latest reason a try failed, or null.
--
-- Columns on an existing table: no change to the sources catalogue.

set search_path = learn, public, extensions;

alter table learn.figure_needs add column if not exists served_kind text;
alter table learn.figure_needs add column if not exists served_at timestamptz;
alter table learn.figure_needs add column if not exists unserved_reason text;
alter table learn.figure_needs add column if not exists tried_at timestamptz;

comment on column learn.figure_needs.served_kind is
  'The figure kind that replaced the lesson''s wanted block (plan #2321.11).';
comment on column learn.figure_needs.served_at is
  'When the wanted block was replaced; null while the lesson still shows its caption.';
comment on column learn.figure_needs.unserved_reason is
  'Why the writer could not fill the block at its last try, or null.';
comment on column learn.figure_needs.tried_at is
  'When the backfill last tried to fill the block.';

create index if not exists figure_needs_unserved_idx on learn.figure_needs (user_id, key) where served_at is null;

-- Adds columns at the end, so create or replace can keep the old ones in order.
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
  step.plan_item_id,
  (array_agg(n.unserved_reason order by n.tried_at desc nulls last) filter (where n.unserved_reason is not null))[1] as unserved_reason
from learn.figure_needs n
join learn.figure_needs first on first.id = n.key
left join learn.figure_need_steps step on step.user_id = n.user_id and step.key = n.key
where n.served_at is null
group by n.user_id, n.key, first.need, first.shows, first.why, first.caption, step.plan_item_id;

comment on view learn.figure_need_groups is
  'One row per grouped figure need still unserved, with how many lessons wait on it and the plan step written for it (plans #2321.9, #2321.10, #2321.11).';

grant select on learn.figure_need_groups to authenticated, service_role;
revoke all on learn.figure_need_groups from anon;
