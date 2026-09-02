-- The public case page: the requirement map, shared by link.
--
-- This is the only unauthenticated read in an application where every table is
-- RLS-protected and tests/rls-jobs.test.ts exists to keep it that way, so the
-- read path is deliberately one narrow function rather than a policy change.
--
-- Three things it is NOT, each ruled out on purpose:
--
--   * Not a service-role client in a route handler. That bypasses RLS entirely
--     and makes the route the only thing standing between a typo and every
--     row in the database.
--   * Not an anon SELECT policy on cover_letters. A policy that admits anon
--     when a slug matches is a policy every future query on that table
--     inherits, and the next person to add a join gets the exemption for free.
--   * Not a view. A view would need the same anon grant and could not take the
--     slug as an argument, so the expiry check would live in the caller.
--
-- `security definer` because the caller genuinely has no session and therefore
-- no `auth.uid()` to check a policy against. It is safe because the function
-- itself is the whole authorization decision, it is visible here in full, and
-- it can only ever return one shared, unexpired case page: no user_id is
-- accepted, no table is exposed, and the slug is the only input.
--
-- 0005 revokes anon and authenticated from the definer helpers because they
-- were never meant to be called over PostgREST. This one is the exception that
-- proves the rule -- being called by anon is its entire purpose -- which is
-- why it takes no caller-supplied identity and returns a fixed shape.

set search_path = job_search, extensions;

-- Gaps do not leave the database.
--
-- The private map exists to tell you what you cannot claim; the public page
-- exists to show what you can. Rendering "nothing in the bank covers this" to
-- an employer would be a different product. Filtering here rather than in the
-- page means the honest answer to "what does this URL expose" is that gap
-- lines were never sent.
create or replace function job_search.public_case_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = job_search, pg_temp
as $$
  with letter as (
    select cl.id, cl.body, cl.evidence_item_ids, cl.application_id, cl.user_id
      from job_search.cover_letters cl
     where cl.public_slug = p_slug
       and p_slug is not null
       and length(p_slug) >= 16
       and cl.public_expires_at is not null
       and cl.public_expires_at > now()
     limit 1
  ),
  role_row as (
    select r.title, r.requirement_matches, c.name as company_name
      from letter l
      join job_search.applications a on a.id = l.application_id
      join job_search.roles r on r.id = a.role_id
      join job_search.companies c on c.id = r.company_id
  ),
  shown as (
    select m.value as match
      from role_row rr
      cross join lateral jsonb_array_elements(coalesce(rr.requirement_matches, '[]'::jsonb)) m
     where m.value ->> 'verdict' in ('strong', 'partial')
       and m.value ->> 'kind' in ('must_have', 'nice_to_have')
  ),
  cited as (
    -- Only the items the shown lines actually reference, plus whatever the
    -- letter itself cites. Nothing else in the bank is reachable from here.
    select distinct e.id, e.title, e.body, e.context, e.metrics
      from job_search.evidence_items e
      join letter l on l.user_id = e.user_id
     where e.id::text in (select s.match ->> 'evidence_item_id' from shown s)
        or e.id = any (l.evidence_item_ids)
  )
  select jsonb_build_object(
    'company', (select company_name from role_row),
    'role', (select title from role_row),
    'body', (select body from letter),
    'matches', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'requirement', s.match ->> 'requirement',
         'kind',        s.match ->> 'kind',
         'verdict',     s.match ->> 'verdict',
         'why',         s.match ->> 'why',
         'evidenceItemId', s.match ->> 'evidence_item_id'
       )) from shown s), '[]'::jsonb),
    'evidence', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'id', c.id, 'title', c.title, 'body', c.body,
         'context', c.context, 'metrics', c.metrics
       )) from cited c), '[]'::jsonb)
  )
  from letter;
$$;

revoke all on function job_search.public_case_page(text) from public;
grant execute on function job_search.public_case_page(text) to anon, authenticated;

