-- The numbers behind insights, worked out each night with no model call, and
-- the tripwires that bring an insight back (plan #2413.7, under #2413).
--
-- The monthly insight call (#2413.9) and the tripwires (#2413.11) start from
-- these numbers rather than recounting. you.compute_insight_signals is a stage
-- of the daily cron (inngest/you/insight-signals.ts); it writes one row a day
-- for the owner and checks every tripwire on a shown insight.
--
-- 1. you.insight_signals
--
-- One row per person per day, the day being the date in their timezone
-- (core.account_settings). signals holds, as of that morning:
--
--   applications       submitted and past_screen, overall, in the last seven
--                      days, and by_bucket: the first of their target titles
--                      (job_search.profiles) the role's title contains, or
--                      "other". Past the screen means a screen, interview,
--                      assessment or offer happened, or the rejection came at
--                      the recruiter screen or later.
--   saved_leads_stale  leads saved more than 14 days ago, still leads.
--   goal_steps_closed  steps now done, by who closed them in goals.history:
--                      "you" for the person and their captures, "dash" for the
--                      rest; overall and in the last seven days.
--   dropped_asks       their own steps that ask someone for something (ask,
--                      send, call, email, reach out ...) that were dropped.
--   views_7d           page views in the last seven days: build (the dev
--                      workspace), other, late_night (midnight to 5am local)
--                      and build_days (days with any build view).
--   feedback_filed     feedback items filed, overall and in the last seven days.
--   deadlines_passed   open goal items past their due date, and job deadline
--                      reminders past due and not done.
--   job_thoughts       job search thoughts written, overall and in 30 days.
--   rules              their excluded industries (the job profile's rules):
--                      how many, and the applications that break one written
--                      before them. A rule counts as written by the earlier of
--                      the first thought naming it and the profile's last
--                      edit. The cron passes each rule's words from
--                      lib/jobs/suggest/payload.ts (exclusionWords); a rule
--                      with none given matches its own name.
--   tripwires          how many were checked, and those that fired today.
--
-- 2. you.insight_tripwires
--
-- What brings an insight back to the top of the deck (#2413.11). The kinds:
--
--   building_while_waiting    build views on params.days (3) days within
--                             params.window_days (7) since an application
--                             with no reply was sent. Fires once a window.
--   deadline_during_building  a deadline passed in the last
--                             params.window_days (7) on a day with build
--                             views, after the last fire.
--   rule_broken               an application, sent after the last fire (or
--                             after the tripwire was written), that breaks a
--                             rule written before it; params.rule narrows it
--                             to one rule.
--   want_recurring            params.words named params.min_mentions (2)
--                             times within params.window_days (30) in job
--                             thoughts, captures or private notes, with no
--                             goal item or application matching them in that
--                             time. Fires once a window.
--
-- fired_evidence is what the check found the last time it fired; the
-- deck shows it under the card.
--
-- Both tables are written by the cron and the insight call, through the
-- service role. A person may read their own.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------

create table you.insight_signals (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  signals jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint insight_signals_object_ck check (jsonb_typeof(signals) = 'object')
);

comment on table you.insight_signals is
  'The numbers behind insights about the person, one row a day, worked out by the daily cron with no model call (plan #2413.7).';

create table you.insight_tripwires (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  insight_id uuid not null,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_fired_at timestamptz,
  fired_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint insight_tripwires_kind_ck check (
    kind in ('building_while_waiting', 'deadline_during_building', 'rule_broken', 'want_recurring')
  ),
  constraint insight_tripwires_params_ck check (jsonb_typeof(params) = 'object'),
  constraint insight_tripwires_evidence_ck check (fired_evidence is null or jsonb_typeof(fired_evidence) = 'object'),

  foreign key (insight_id, user_id)
    references you.insights (id, user_id) on delete cascade
);

comment on table you.insight_tripwires is
  'What brings an insight back: a kind, its settings, and when it last fired with what evidence (plan #2413.7).';

create index insight_tripwires_insight_idx on you.insight_tripwires (insight_id);
create index insight_tripwires_user_idx on you.insight_tripwires (user_id);

create trigger insight_tripwires_touch_updated_at
  before update on you.insight_tripwires
  for each row execute function you.touch_updated_at();

alter table you.insight_signals enable row level security;
alter table you.insight_tripwires enable row level security;

create policy insight_signals_read on you.insight_signals for select to authenticated
  using (user_id = (select auth.uid()));

create policy insight_tripwires_read on you.insight_tripwires for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.insight_signals, you.insight_tripwires from anon, authenticated;
grant select on you.insight_signals, you.insight_tripwires to authenticated;
grant select, insert, update, delete on you.insight_signals, you.insight_tripwires to service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------------

-- A word as a case-insensitive whole-word pattern, its plural included.
create or replace function you.word_pattern(p_words text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case when count(*) = 0 then null else
    '\m(' || string_agg(regexp_replace(lower(btrim(w)), '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), '|') || ')s?\M'
  end
  from unnest(p_words) as w
  where btrim(w) <> '';
$$;

-- A whole number from params, or the default when it is missing or not one.
create or replace function you.param_int(p_params jsonb, p_key text, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_params ->> p_key ~ '^\d{1,4}$' then (p_params ->> p_key)::integer else p_default end;
$$;

revoke all on function you.word_pattern(text[]) from public, anon, authenticated;
revoke all on function you.param_int(jsonb, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The nightly count.
-- ---------------------------------------------------------------------------

create or replace function you.compute_insight_signals(
  p_user_id uuid,
  p_rule_words jsonb default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_since7 timestamptz := p_now - interval '7 days';
  v_since30 timestamptz := p_now - interval '30 days';
  v_applications jsonb;
  v_leads integer;
  v_closed jsonb;
  v_dropped jsonb;
  v_views jsonb;
  v_feedback jsonb;
  v_deadlines jsonb;
  v_thoughts jsonb;
  v_rules_written integer;
  v_broken jsonb;
  v_checked integer := 0;
  v_fired jsonb;
  v_signals jsonb;
  t record;
  v_window integer;
  v_days integer;
  v_min integer;
  v_pattern text;
  v_evidence jsonb;
  v_since timestamptz;
  v_count integer;
begin
  if p_user_id is null then
    raise exception 'compute_insight_signals needs a user id';
  end if;

  select coalesce(nullif(btrim(s.timezone), ''), 'UTC') into v_tz
    from core.account_settings s where s.user_id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');
  v_today := (p_now at time zone v_tz)::date;

  -- Rules: each excluded industry, its words, and when it was written by.
  create temporary table if not exists pg_temp.insight_rules (
    rule text, pattern text, written_by timestamptz
  ) on commit drop;
  truncate pg_temp.insight_rules;
  insert into pg_temp.insight_rules
  select r.rule,
         you.word_pattern(case
           when jsonb_typeof(p_rule_words -> r.rule) = 'array' and jsonb_array_length(p_rule_words -> r.rule) > 0
             then array(select jsonb_array_elements_text(p_rule_words -> r.rule))
           else array[r.rule] end),
         least(p.updated_at, (
           select min(th.created_at) from job_search.thoughts th
            where th.user_id = p_user_id and th.body ~* you.word_pattern(array[r.rule])))
    from job_search.profiles p
    cross join lateral unnest(p.excluded_industries) as r(rule)
   where p.id = p_user_id and btrim(r.rule) <> '';

  -- Applications that break a rule written before they were sent.
  create temporary table if not exists pg_temp.insight_broken (
    application_id uuid, submitted_at timestamptz, company text, role text, rule text, written_by timestamptz
  ) on commit drop;
  truncate pg_temp.insight_broken;
  insert into pg_temp.insight_broken
  select distinct on (a.id) a.id, a.submitted_at, c.name, ro.title, ru.rule, ru.written_by
    from job_search.applications a
    join job_search.roles ro on ro.id = a.role_id and ro.user_id = a.user_id
    left join job_search.companies c on c.id = ro.company_id and c.user_id = a.user_id
    join pg_temp.insight_rules ru
      on ru.pattern is not null
     and ru.written_by < a.submitted_at
     and concat_ws(' ', c.industry, c.name) ~* ru.pattern
   where a.user_id = p_user_id and a.submitted_at is not null
   order by a.id, ru.written_by;

  select count(*) into v_rules_written from pg_temp.insight_rules;
  select jsonb_build_object(
           'written', v_rules_written,
           'broken', count(*),
           'broken_applications', coalesce(jsonb_agg(jsonb_build_object(
             'application_id', b.application_id, 'company', b.company, 'role', b.role,
             'rule', b.rule, 'submitted_at', b.submitted_at, 'rule_written_by', b.written_by)
             order by b.submitted_at desc), '[]'::jsonb))
    into v_broken
    from pg_temp.insight_broken b;

  -- Applications by role bucket, and how many got past the screen.
  with apps as (
    select a.submitted_at,
           coalesce((
             select u.t from job_search.profiles p
             cross join lateral unnest(p.target_titles) with ordinality as u(t, n)
              where p.id = p_user_id and btrim(u.t) <> ''
                and position(lower(btrim(u.t)) in lower(coalesce(ro.title, ''))) > 0
              order by u.n limit 1), 'other') as bucket,
           (a.status::text in ('in_process', 'final_round', 'offer')
             or a.outcome::text in ('offer_declined', 'offer_accepted')
             or coalesce(a.rejection_stage_override, a.rejection_stage)::text
                  in ('recruiter_screen', 'hiring_manager', 'technical', 'onsite', 'final', 'offer_stage')
             or exists (
               select 1 from job_search.application_events e
                where e.application_id = a.id and e.user_id = a.user_id
                  and e.kind::text in ('screen_scheduled', 'interview_scheduled', 'interview_completed',
                                       'assessment_sent', 'offer'))) as past_screen
      from job_search.applications a
      left join job_search.roles ro on ro.id = a.role_id and ro.user_id = a.user_id
     where a.user_id = p_user_id and a.submitted_at is not null
  ), buckets as (
    select bucket, count(*) as submitted, count(*) filter (where past_screen) as past
      from apps group by bucket
  )
  select jsonb_build_object(
           'submitted', (select count(*) from apps),
           'past_screen', (select count(*) from apps where past_screen),
           'submitted_7d', (select count(*) from apps where submitted_at >= v_since7),
           'by_bucket', coalesce((select jsonb_object_agg(bucket,
                          jsonb_build_object('submitted', submitted, 'past_screen', past)) from buckets), '{}'::jsonb))
    into v_applications;

  select count(*) into v_leads
    from job_search.applications a
   where a.user_id = p_user_id and a.status::text = 'lead' and a.closed_at is null
     and a.created_at < p_now - interval '14 days';

  -- Steps now done, by who last closed them.
  with closes as (
    select distinct on (h.row_id) h.row_id, h.actor, h.created_at
      from goals.history h
      join goals.items i on i.id = h.row_id and i.user_id = h.user_id
     where h.user_id = p_user_id and h.table_name = 'items'
       and h.new_values ->> 'status' = 'done'
       and i.level = 'step' and i.status = 'done'
     order by h.row_id, h.created_at desc
  )
  select jsonb_build_object(
           'you', count(*) filter (where actor in ('me', 'capture')),
           'dash', count(*) filter (where actor not in ('me', 'capture')),
           'you_7d', count(*) filter (where actor in ('me', 'capture') and created_at >= v_since7),
           'dash_7d', count(*) filter (where actor not in ('me', 'capture') and created_at >= v_since7))
    into v_closed from closes;

  select jsonb_build_object(
           'total', count(*),
           'last_30d', count(*) filter (where coalesce(i.closed_at, i.updated_at) >= v_since30))
    into v_dropped
    from goals.items i
   where i.user_id = p_user_id and i.level = 'step' and i.status = 'dropped'
     and i.kind is distinct from 'claude'
     and i.title ~* '^\s*(ask|send|call|email|e-mail|message|text|reach out|follow up|introduce|request|reply|contact|dm|ping|invite|pitch)\M';

  select jsonb_build_object(
           'build', count(*) filter (where v.workspace = 'dev'),
           'other', count(*) filter (where v.workspace is distinct from 'dev'),
           'late_night', count(*) filter (where extract(hour from v.viewed_at at time zone v_tz) < 5),
           'build_days', count(distinct (v.viewed_at at time zone v_tz)::date) filter (where v.workspace = 'dev'))
    into v_views
    from core.page_views v
   where v.user_id = p_user_id and v.viewed_at >= v_since7 and v.viewed_at <= p_now;

  select jsonb_build_object('total', count(*), 'last_7d', count(*) filter (where f.created_at >= v_since7))
    into v_feedback
    from public.feedback_items f where f.user_id = p_user_id and f.created_at <= p_now;

  select jsonb_build_object(
           'goal_items', (select count(*) from goals.items i
                           where i.user_id = p_user_id and i.status in ('open', 'blocked')
                             and i.archived_at is null and i.due_on < v_today),
           'job_reminders', (select count(*) from job_search.reminders r
                              where r.user_id = p_user_id and r.kind::text = 'deadline'
                                and r.completed_at is null and r.due_at < p_now))
    into v_deadlines;

  select jsonb_build_object('total', count(*), 'last_30d', count(*) filter (where th.created_at >= v_since30))
    into v_thoughts
    from job_search.thoughts th where th.user_id = p_user_id and th.created_at <= p_now;

  -- Tripwires on shown insights.
  for t in
    select w.* from you.insight_tripwires w
      join you.insights i on i.id = w.insight_id and i.user_id = w.user_id
     where w.user_id = p_user_id and i.status = 'shown'
     order by w.created_at
  loop
    v_checked := v_checked + 1;
    v_evidence := null;

    if t.kind = 'building_while_waiting' then
      v_days := you.param_int(t.params, 'days', 3);
      v_window := you.param_int(t.params, 'window_days', 7);
      if t.last_fired_at is null or t.last_fired_at < p_now - make_interval(days => v_window) then
        with build_days as (
          select distinct (v.viewed_at at time zone v_tz)::date as day
            from core.page_views v
           where v.user_id = p_user_id and v.workspace = 'dev'
             and v.viewed_at >= p_now - make_interval(days => v_window) and v.viewed_at <= p_now
        ), waiting as (
          select a.id, a.submitted_at, c.name as company, ro.title as role,
                 array(select d.day from build_days d
                        where d.day >= (a.submitted_at at time zone v_tz)::date order by d.day) as days
            from job_search.applications a
            left join job_search.roles ro on ro.id = a.role_id and ro.user_id = a.user_id
            left join job_search.companies c on c.id = ro.company_id and c.user_id = a.user_id
           where a.user_id = p_user_id and a.submitted_at is not null and a.submitted_at <= p_now
             and a.first_human_response_at is null and a.closed_at is null and a.outcome is null
             and a.status::text in ('submitted', 'acknowledged')
        )
        select case when count(*) > 0 then jsonb_build_object(
                 'build_days', (select jsonb_agg(d.day order by d.day) from build_days d),
                 'waiting', jsonb_agg(jsonb_build_object(
                   'application_id', w.id, 'company', w.company, 'role', w.role,
                   'submitted_at', w.submitted_at, 'build_days_since', cardinality(w.days))
                   order by w.submitted_at))
               end
          into v_evidence
          from waiting w where cardinality(w.days) >= v_days;
      end if;

    elsif t.kind = 'deadline_during_building' then
      v_window := you.param_int(t.params, 'window_days', 7);
      with deadlines as (
        select 'goals.items' as source, i.id, i.title, i.due_on as day
          from goals.items i
         where i.user_id = p_user_id and i.status in ('open', 'blocked') and i.archived_at is null
           and i.due_on >= v_today - v_window and i.due_on < v_today
        union all
        select 'job_search.reminders', r.id, coalesce(r.body, 'Deadline'), (r.due_at at time zone v_tz)::date
          from job_search.reminders r
         where r.user_id = p_user_id and r.kind::text = 'deadline' and r.completed_at is null
           and r.due_at >= p_now - make_interval(days => v_window) and r.due_at < p_now
      ), built as (
        select d.source, d.id, d.title, d.day, count(v.id) as build_views
          from deadlines d
          join core.page_views v
            on v.user_id = p_user_id and v.workspace = 'dev'
           and (v.viewed_at at time zone v_tz)::date = d.day
         where t.last_fired_at is null or d.day > (t.last_fired_at at time zone v_tz)::date
         group by d.source, d.id, d.title, d.day
      )
      select case when count(*) > 0 then jsonb_build_object('deadlines', jsonb_agg(jsonb_build_object(
               'source', b.source, 'row_id', b.id, 'title', b.title, 'day', b.day, 'build_views', b.build_views)
               order by b.day)) end
        into v_evidence from built b;

    elsif t.kind = 'rule_broken' then
      v_since := coalesce(t.last_fired_at, t.created_at);
      select case when count(*) > 0 then jsonb_build_object('applications', jsonb_agg(jsonb_build_object(
               'application_id', b.application_id, 'company', b.company, 'role', b.role, 'rule', b.rule,
               'submitted_at', b.submitted_at, 'rule_written_by', b.written_by) order by b.submitted_at)) end
        into v_evidence
        from pg_temp.insight_broken b
       where b.submitted_at > v_since and b.submitted_at <= p_now
         and (t.params ->> 'rule' is null or lower(b.rule) = lower(t.params ->> 'rule'));

    elsif t.kind = 'want_recurring' then
      v_window := you.param_int(t.params, 'window_days', 30);
      v_min := you.param_int(t.params, 'min_mentions', 2);
      v_since := p_now - make_interval(days => v_window);
      v_pattern := case when jsonb_typeof(t.params -> 'words') = 'array'
                        then you.word_pattern(array(select jsonb_array_elements_text(t.params -> 'words')))
                   end;
      if v_pattern is not null
         and (t.last_fired_at is null or t.last_fired_at < v_since) then
        select count(*) into v_count from (
          select 1 from goals.items i
           where i.user_id = p_user_id and i.title ~* v_pattern
             and (i.created_at >= v_since or i.closed_at >= v_since)
          union all
          select 1 from job_search.applications a
            join job_search.roles ro on ro.id = a.role_id and ro.user_id = a.user_id
            left join job_search.companies c on c.id = ro.company_id and c.user_id = a.user_id
           where a.user_id = p_user_id and a.submitted_at >= v_since and a.submitted_at <= p_now
             and concat_ws(' ', ro.title, c.name) ~* v_pattern
        ) acted;

        if v_count = 0 then
          with mentions as (
            select 'job_search.thoughts' as source, th.id::text as row_id, th.created_at as at
              from job_search.thoughts th
             where th.user_id = p_user_id and th.created_at >= v_since and th.created_at <= p_now
               and th.body ~* v_pattern
            union all
            select 'goals.captures', gc.id::text, gc.created_at
              from goals.captures gc
             where gc.user_id = p_user_id and gc.created_at >= v_since and gc.created_at <= p_now
               and gc.body ~* v_pattern
            union all
            select 'obsidian.notes', n.path, coalesce(n.git_updated_at, n.updated_at)
              from obsidian.notes n
             where n.user_id = p_user_id and n.deleted_at is null and n.voice = 'private'
               and coalesce(n.git_updated_at, n.updated_at) >= v_since
               and coalesce(n.git_updated_at, n.updated_at) <= p_now
               and n.body ~* v_pattern
          )
          select case when count(*) >= v_min then jsonb_build_object(
                   'words', t.params -> 'words',
                   'mentions', jsonb_agg(jsonb_build_object('source', m.source, 'row_id', m.row_id, 'at', m.at)
                                         order by m.at)) end
            into v_evidence from mentions m;
        end if;
      end if;
    end if;

    update you.insight_tripwires w
       set last_checked_at = p_now,
           last_fired_at = case when v_evidence is not null then p_now else w.last_fired_at end,
           fired_evidence = coalesce(v_evidence, w.fired_evidence)
     where w.id = t.id;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tripwire_id', w.id, 'insight_id', w.insight_id, 'kind', w.kind,
           'fired_at', w.last_fired_at, 'evidence', w.fired_evidence) order by w.last_fired_at), '[]'::jsonb)
    into v_fired
    from you.insight_tripwires w
   where w.user_id = p_user_id and w.last_fired_at is not null
     and (w.last_fired_at at time zone v_tz)::date = v_today;

  v_signals := jsonb_build_object(
    'applications', v_applications,
    'saved_leads_stale', v_leads,
    'goal_steps_closed', v_closed,
    'dropped_asks', v_dropped,
    'views_7d', v_views,
    'feedback_filed', v_feedback,
    'deadlines_passed', v_deadlines,
    'job_thoughts', v_thoughts,
    'rules', v_broken,
    'tripwires', jsonb_build_object('checked', v_checked, 'fired', v_fired)
  );

  insert into you.insight_signals (user_id, day, signals, computed_at)
  values (p_user_id, v_today, v_signals, p_now)
  on conflict (user_id, day) do update
    set signals = excluded.signals, computed_at = excluded.computed_at;

  return v_signals;
end;
$$;

comment on function you.compute_insight_signals(uuid, jsonb, timestamptz) is
  'Writes today''s insight numbers for one person and checks their tripwires, with no model call (plan #2413.7).';

revoke all on function you.compute_insight_signals(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function you.compute_insight_signals(uuid, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
