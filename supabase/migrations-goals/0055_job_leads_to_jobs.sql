-- ===========================================================================
-- A job lead the weekly run finds is also a recommended role in Jobs.
--
-- The weekly run writes openings it finds for a goal to goals.suggestions with
-- kind 'job_leads', where they show on the Goals home. The Roles page reads
-- its recommended roles from job_search.suggestions (job_search 0028), so the
-- leads never reached it. This trigger copies each one across as it is
-- written, as an 'apply' suggestion with found_in naming the goal.
--
-- A lead whose link is already there (suggested, saved or turned down before)
-- is skipped, by the same unique index that stops the suggestion run
-- suggesting a posting twice.
-- ===========================================================================

create or replace function goals.job_lead_to_jobs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  goal_title text;
begin
  if new.kind <> 'job_leads' or new.url is null then
    return new;
  end if;

  select title into goal_title from goals.items where id = new.item_id;

  insert into job_search.suggestions
    (user_id, kind, headline, why, move, url, location, found_in, goal_item_id, model)
  values (
    new.user_id,
    'apply',
    left(new.title, 300),
    coalesce(nullif(btrim(new.detail), ''), 'Found by the weekly goals run.'),
    'Open the posting and read it through. If it fits, save it as a lead and apply from the pipeline.',
    new.url,
    new.place,
    left('Weekly goals run' || coalesce(' for ' || goal_title, ''), 300),
    new.item_id,
    'goals weekly run'
  )
  on conflict (user_id, url) where url is not null do nothing;

  return new;
end;
$$;

revoke all on function goals.job_lead_to_jobs() from public, anon, authenticated;

drop trigger if exists suggestions_job_lead_to_jobs on goals.suggestions;
create trigger suggestions_job_lead_to_jobs after insert on goals.suggestions
  for each row execute function goals.job_lead_to_jobs();

-- Leads written before this trigger, still current and not turned down.
insert into job_search.suggestions
  (user_id, kind, headline, why, move, url, location, found_in, goal_item_id, model, created_at)
select
  s.user_id,
  'apply',
  left(s.title, 300),
  coalesce(nullif(btrim(s.detail), ''), 'Found by the weekly goals run.'),
  'Open the posting and read it through. If it fits, save it as a lead and apply from the pipeline.',
  s.url,
  s.place,
  left('Weekly goals run' || coalesce(' for ' || i.title, ''), 300),
  s.item_id,
  'goals weekly run',
  s.created_at
from goals.suggestions s
left join goals.items i on i.id = s.item_id
where s.kind = 'job_leads'
  and s.url is not null
  and s.reaction is distinct from 'not_for_me'
  and (s.happens_on is null or s.happens_on >= current_date)
on conflict (user_id, url) where url is not null do nothing;
