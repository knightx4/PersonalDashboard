-- Every plan step's outline, for anything that reads the plan through SQL.
--
-- A step is read by where it sits: "1081.3" is the third step under feature
-- #1081. Its number (#1084) is the identity a commit or a stored note points
-- at, and it stays, but nobody reading the plan should have to translate one
-- into the other. The page works the outline out in lib/plan/tree.ts; this
-- view works it out the same way, so a routine or a session querying the
-- database names a step as the page does.
--
-- The rule, matching buildPlanTree: a top-level row's outline is its number;
-- a child's is its parent's outline, a dot, and its place among its siblings,
-- counted from 1 in order of position, then created_at, then number. Every
-- row counts, closed and dropped ones too, so closing a step never renumbers
-- the ones after it.
--
-- security_invoker, so the RLS on plan_items still decides whose rows appear.

set search_path = public, extensions;

create or replace view public.plan_item_outlines with (security_invoker = true) as
with recursive placed as (
  select
    id,
    user_id,
    parent_id,
    number,
    row_number() over (
      partition by user_id, parent_id
      order by position, created_at, number
    ) as place
  from public.plan_items
),
outlined as (
  select id, user_id, number, number::text as outline
  from placed
  where parent_id is null
  union all
  select child.id, child.user_id, child.number, outlined.outline || '.' || child.place
  from placed child
  join outlined on child.parent_id = outlined.id
)
select id, user_id, number, outline from outlined;

comment on view public.plan_item_outlines is
  'Each plan step''s outline ("1081.3"), worked out as lib/plan/tree.ts does. Name steps by this when writing to the person; number stays the stored identity.';

grant select on public.plan_item_outlines to authenticated;
