-- Functions and triggers.
--
-- The important one is sync_application_state(): the single owner of derived
-- application status. Two code paths writing a status field always disagree
-- eventually, and a pipeline board you do not trust is a pipeline board you
-- stop opening. lib/pipeline.ts restates the same rules in TypeScript and
-- tests/status.test.ts asserts the two agree.

set search_path = job_search, extensions;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function job_search.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'companies', 'roles', 'applications', 'application_events',
    'interviews', 'interview_participants', 'contacts', 'contact_touches',
    'resume_versions', 'notes', 'attachments', 'evidence_items', 'questions',
    'application_answers', 'cover_letters', 'email_accounts',
    'ingested_messages', 'sync_jobs', 'reminders'
  ] loop
    execute format(
      'create trigger %I before update on job_search.%I
         for each row execute function job_search.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles are created by trigger, never by application code.
--
-- This inserts into job_search.profiles. Another app's trigger on the same
-- auth.users row inserts into its own; they do not know about each other, which
-- is exactly what makes one login across several apps safe to do.
-- ---------------------------------------------------------------------------
create or replace function job_search.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
begin
  insert into job_search.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- NOT `on_auth_user_created`: auth.users is shared with every other app in
-- this project, and Postgres allows many triggers on one table only while
-- their names differ. Shopping Manager owns the unsuffixed name; taking it
-- would fail this migration, and taking it by dropping theirs would silently
-- stop their signups from creating a profile.
create trigger on_auth_user_created_job_search
  after insert on auth.users
  for each row execute function job_search.handle_new_user();

-- ---------------------------------------------------------------------------
-- Status rank. Forward progress only; the terminal states sit outside it.
-- ---------------------------------------------------------------------------
create or replace function job_search.application_status_rank(s application_status)
returns int
language sql
immutable
as $$
  select case s
    when 'lead' then 0
    when 'drafting' then 1
    when 'submitted' then 2
    when 'acknowledged' then 3
    when 'in_process' then 4
    when 'final_round' then 5
    when 'offer' then 6
    else -1   -- terminal states: rejected, withdrawn, ghosted, role_closed
  end;
$$;

create or replace function job_search.is_terminal_application_status(s application_status)
returns boolean
language sql
immutable
as $$
  select s in ('rejected', 'withdrawn', 'ghosted', 'role_closed');
$$;

-- ---------------------------------------------------------------------------
-- sync_application_state: the one function that owns derived status.
--
-- Rules, all of which have a matching case in tests/status.test.ts:
--
--   1. Status is folded forward over application_events in occurred_at order.
--      Progress never moves backwards: a stray email after a rejection writes
--      its event, leaves the status alone, and flags the event for review.
--      Recruiters do send follow-ups after rejections; silently un-rejecting
--      things is how the board becomes untrustworthy.
--   2. status_manual_override wins when set, and is cleared by any later
--      email-sourced event.
--   3. 'ghosted' is derived from the age of the last event against the user's
--      threshold. It is a view over the data, not a state you can enter.
--   4. first_human_response_at reads only events that required a human to make
--      a decision about you. An automated confirmation is not one, and neither
--      is a bulk rejection -- conflating them makes the response rate look
--      several times better than it is, which defeats the point of measuring.
--   5. rejection_stage is inferred from the status the application was in when
--      the rejection landed, and may be corrected by hand afterwards.
-- ---------------------------------------------------------------------------
create or replace function job_search.sync_application_state(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = job_search, extensions
as $$
declare
  v_user_id uuid;
  v_override application_status;
  v_manual_rejection_stage rejection_stage;
  v_status application_status := 'lead';
  v_event record;
  v_kind application_event_kind;
  v_submitted_at timestamptz;
  v_confirmation_at timestamptz;
  v_first_human_at timestamptz;
  v_closed_at timestamptz;
  v_outcome application_outcome;
  v_rejection_stage rejection_stage;
  v_last_event_at timestamptz;
  v_last_interview_kind text;
  v_threshold int;
  v_target application_status;
  v_override_seen_at timestamptz;
begin
  if p_application_id is null then
    return;
  end if;

  select a.user_id, a.status_manual_override, a.rejection_stage_override
    into v_user_id, v_override, v_manual_rejection_stage
  from applications a
  where a.id = p_application_id;

  if not found then
    return;
  end if;

  -- An override is superseded only by email that arrives after it was set.
  select max(e.occurred_at) into v_override_seen_at
  from application_events e
  where e.application_id = p_application_id and e.kind = 'status_override';

  select coalesce(p.ghost_threshold_days, 30) into v_threshold
  from profiles p where p.id = v_user_id;
  v_threshold := coalesce(v_threshold, 30);

  -- Fold events forward in time order.
  for v_event in
    select e.id, e.kind, e.occurred_at, e.source, e.payload
    from application_events e
    where e.application_id = p_application_id
    order by e.occurred_at asc, e.created_at asc
  loop
    v_kind := v_event.kind;
    v_last_event_at := greatest(coalesce(v_last_event_at, v_event.occurred_at), v_event.occurred_at);

    -- Rule 2, first half: an email-sourced event that arrives after the
    -- override was set supersedes it. Older mail does not.
    if v_event.source = 'email'
       and v_override is not null
       and (v_override_seen_at is null or v_event.occurred_at > v_override_seen_at)
    then
      v_override := null;
    end if;

    v_target := null;

    case v_kind
      when 'submitted' then
        v_target := 'submitted';
        v_submitted_at := least(coalesce(v_submitted_at, v_event.occurred_at), v_event.occurred_at);
      when 'confirmation' then
        v_target := 'acknowledged';
        v_confirmation_at := least(coalesce(v_confirmation_at, v_event.occurred_at), v_event.occurred_at);
      when 'recruiter_reply' then
        v_target := 'in_process';
      when 'screen_scheduled' then
        v_target := 'in_process';
      when 'assessment_sent' then
        v_target := 'in_process';
      when 'assessment_submitted' then
        v_target := 'in_process';
      when 'interview_scheduled' then
        v_target := case
          when coalesce(v_event.payload ->> 'interview_kind', '') in ('final', 'onsite')
            then 'final_round'::application_status
          else 'in_process'::application_status
        end;
      when 'interview_completed' then
        v_target := case
          when coalesce(v_event.payload ->> 'interview_kind', '') in ('final', 'onsite')
            then 'final_round'::application_status
          else 'in_process'::application_status
        end;
      when 'offer' then
        v_target := 'offer';
      else
        v_target := null;
    end case;

    -- Human-response timestamps. Deliberately excludes 'confirmation' (an
    -- automated acknowledgement) and 'rejection' (usually a bulk send).
    if v_kind in ('recruiter_reply', 'screen_scheduled', 'assessment_sent',
                  'interview_scheduled', 'offer') then
      v_first_human_at := least(coalesce(v_first_human_at, v_event.occurred_at), v_event.occurred_at);
    end if;

    if v_kind = 'interview_scheduled' or v_kind = 'interview_completed' then
      v_last_interview_kind := coalesce(v_event.payload ->> 'interview_kind', v_last_interview_kind);
    end if;

    -- Terminal events.
    if v_kind = 'rejection' then
      if not job_search.is_terminal_application_status(v_status) then
        v_rejection_stage := case
          when v_status in ('lead', 'drafting', 'submitted') then 'pre_screen'
          when v_status = 'acknowledged' then 'resume_review'
          when v_status = 'final_round' then 'final'
          when v_status = 'offer' then 'offer_stage'
          when v_status = 'in_process' then case v_last_interview_kind
            when 'recruiter_screen' then 'recruiter_screen'
            when 'hiring_manager' then 'hiring_manager'
            when 'technical' then 'technical'
            when 'case' then 'technical'
            when 'panel' then 'onsite'
            when 'onsite' then 'onsite'
            when 'final' then 'final'
            else 'recruiter_screen'
          end
          else 'unknown'
        end;
        v_status := 'rejected';
        v_closed_at := v_event.occurred_at;
        v_outcome := 'rejected';
      end if;
      continue;
    end if;

    if v_kind = 'withdrawal' then
      if not job_search.is_terminal_application_status(v_status) then
        v_status := 'withdrawn';
        v_closed_at := v_event.occurred_at;
        v_outcome := 'withdrawn';
      end if;
      continue;
    end if;

    if v_target is null then
      continue;
    end if;

    -- Rule 1: never move backwards, and never reopen a terminal application
    -- from an inbound email. Flag the event instead.
    if job_search.is_terminal_application_status(v_status) then
      update application_events set needs_review = true
        where id = v_event.id and needs_review = false;
      continue;
    end if;

    if job_search.application_status_rank(v_target) > job_search.application_status_rank(v_status) then
      v_status := v_target;
    end if;
  end loop;

  -- Rule 2: an override that has not been superseded by a later email event wins.
  if v_override is not null then
    v_status := v_override;
    if v_override_seen_at is not null then
      v_last_event_at := greatest(coalesce(v_last_event_at, v_override_seen_at), v_override_seen_at);
    end if;
    if job_search.is_terminal_application_status(v_override) then
      v_closed_at := coalesce(v_closed_at, v_override_seen_at, now());
      v_outcome := coalesce(v_outcome, case v_override
        when 'rejected' then 'rejected'::application_outcome
        when 'withdrawn' then 'withdrawn'::application_outcome
        when 'role_closed' then 'role_closed'::application_outcome
        else null
      end);
    else
      v_closed_at := null;
      v_outcome := null;
    end if;
  end if;

  -- Rule 3: ghosting is a function of silence, applied to live applications
  -- only. 'lead' and 'drafting' describe your own inaction rather than theirs,
  -- and an outstanding 'offer' is a decision waiting on you -- sweeping that
  -- into the ghost bucket would erase the offer from the funnel.
  if not job_search.is_terminal_application_status(v_status)
     and v_status not in ('lead', 'drafting', 'offer')
     and v_last_event_at is not null
     and v_last_event_at < now() - make_interval(days => v_threshold)
  then
    v_status := 'ghosted';
    v_outcome := 'ghosted';
    v_closed_at := coalesce(v_closed_at, v_last_event_at + make_interval(days => v_threshold));
  end if;

  update applications
     set status = v_status,
         submitted_at = coalesce(v_submitted_at, submitted_at),
         confirmation_received_at = v_confirmation_at,
         first_human_response_at = v_first_human_at,
         closed_at = v_closed_at,
         outcome = v_outcome,
         -- a hand-corrected rejection stage is never overwritten by inference
         rejection_stage = coalesce(v_manual_rejection_stage, v_rejection_stage)
   where id = p_application_id;
end;
$$;

create or replace function job_search.sync_application_state_from_event()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
begin
  perform job_search.sync_application_state(
    case tg_op when 'DELETE' then old.application_id else new.application_id end
  );
  return null;
end;
$$;

create trigger application_events_sync_state
  after insert or update or delete on application_events
  for each row execute function job_search.sync_application_state_from_event();

create or replace function job_search.sync_application_state_self()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
begin
  perform job_search.sync_application_state(new.id);
  return null;
end;
$$;

-- Only these two columns re-derive; updating status itself must not recurse.
create trigger applications_sync_state
  after insert or update of status_manual_override, rejection_stage_override on applications
  for each row execute function job_search.sync_application_state_self();

-- ---------------------------------------------------------------------------
-- The ghost sweep, as a set-based function. Called nightly by /api/cron/sweep.
-- Nothing here is a manual state change: it only re-runs the derivation for
-- applications whose last event has aged past the user's threshold.
-- ---------------------------------------------------------------------------
create or replace function job_search.sweep_ghosted_applications(p_user_id uuid default null)
returns int
language plpgsql
security definer
set search_path = job_search, extensions
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id
    from applications a
    join profiles p on p.id = a.user_id
    where (p_user_id is null or a.user_id = p_user_id)
      and a.status in ('submitted', 'acknowledged', 'in_process', 'final_round')
      and coalesce(
            (select max(e.occurred_at) from application_events e where e.application_id = a.id),
            a.created_at
          ) < now() - make_interval(days => coalesce(p.ghost_threshold_days, 30))
  loop
    perform job_search.sync_application_state(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies.status is derived too: a company is active while any of its
-- applications is live, closed_out once they have all ended.
-- ---------------------------------------------------------------------------
create or replace function job_search.sync_company_status(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = job_search
as $$
declare
  v_total int;
  v_live int;
begin
  if p_company_id is null then return; end if;

  select count(*), count(*) filter (
           where not job_search.is_terminal_application_status(a.status)
         )
    into v_total, v_live
  from applications a
  join roles r on r.id = a.role_id
  where r.company_id = p_company_id;

  update companies
     set status = case
       when v_total = 0 then 'no_activity'::company_status
       when v_live > 0 then 'active'::company_status
       else 'closed_out'::company_status
     end
   where id = p_company_id;
end;
$$;

create or replace function job_search.sync_company_status_from_application()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
declare
  v_role_id uuid;
  v_company_id uuid;
begin
  v_role_id := case tg_op when 'DELETE' then old.role_id else new.role_id end;
  select company_id into v_company_id from roles where id = v_role_id;
  perform job_search.sync_company_status(v_company_id);
  return null;
end;
$$;

create trigger applications_sync_company_status
  after insert or update of status or delete on applications
  for each row execute function job_search.sync_company_status_from_application();

-- ---------------------------------------------------------------------------
-- Question bank bookkeeping: times_seen increments when the same fingerprint
-- is asked again, which is what makes the reuse loop measurable.
-- ---------------------------------------------------------------------------
create or replace function job_search.touch_question_seen(p_question_id uuid)
returns void
language sql
security definer
set search_path = job_search
as $$
  update questions set times_seen = times_seen + 1 where id = p_question_id;
$$;
