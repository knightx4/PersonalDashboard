-- Recording which morning briefs and picks were opened (plan #1242).
--
-- Two functions, one for each thing the app records:
--
--   core.open_day_brief(day)          sets opened_at on that day's brief when
--                                     the home page is opened from the
--                                     notification. Only the first open
--                                     counts; a later one changes nothing.
--   core.open_day_brief_pick(day, key)
--                                     adds opened_at to the pick with that key
--                                     inside picks when its link on the home
--                                     page is followed. Again only the first.
--
-- The authenticated role keeps select alone on core.day_briefs, so the person
-- cannot rewrite the body or the picks through the API. These run as their
-- owner and touch only the caller's own row (auth.uid()) and only the one
-- column each is for. Both return whether they stamped anything.
--
-- Nothing reads the record yet. It is kept so the order the brief ranks kinds
-- in can later be checked against what is actually opened.

set search_path = core, public, extensions;

create or replace function core.open_day_brief(p_day date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update core.day_briefs
     set opened_at = now()
   where user_id = auth.uid()
     and day = p_day
     and opened_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function core.open_day_brief_pick(p_day date, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update core.day_briefs b
     set picks = (
       select jsonb_agg(
                case
                  when e.pick ->> 'key' = p_key and not (e.pick ? 'opened_at')
                    then e.pick || jsonb_build_object('opened_at', now())
                  else e.pick
                end
                order by e.n)
         from jsonb_array_elements(b.picks) with ordinality as e(pick, n)
     )
   where b.user_id = auth.uid()
     and b.day = p_day
     and jsonb_typeof(b.picks) = 'array'
     and exists (
       select 1
         from jsonb_array_elements(b.picks) as p(pick)
        where p.pick ->> 'key' = p_key
          and not (p.pick ? 'opened_at')
     );
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function core.open_day_brief(date) from public, anon;
revoke all on function core.open_day_brief_pick(date, text) from public, anon;
grant execute on function core.open_day_brief(date) to authenticated, service_role;
grant execute on function core.open_day_brief_pick(date, text) to authenticated, service_role;

comment on function core.open_day_brief(date) is
  'Stamps opened_at on the caller''s brief for the day, once, when it is opened from the notification (plan #1242).';
comment on function core.open_day_brief_pick(date, text) is
  'Stamps opened_at on one pick inside the caller''s brief for the day, once, when its link is followed (plan #1242).';
