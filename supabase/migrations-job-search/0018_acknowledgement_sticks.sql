-- "Leave it closed" has to survive the next state recalculation.
--
-- sync_application_state() re-derives needs_review for every event that landed
-- on a terminal pursuit, from the event's kind alone. That is right for mail
-- arriving after the fact, and wrong the moment a person has already looked at
-- the row: clearing the flag from the review queue is itself an update to
-- application_events, which fires the sync trigger, which immediately re-flags
-- the event from its kind. The click wrote a row, bumped updated_at, and left
-- the queue exactly as it was -- there was no way to acknowledge a conflict at
-- all.
--
-- So the flag stops being purely derived: a human verdict is recorded in
-- acknowledged_at, and the derivation defers to it. The rule is otherwise
-- unchanged -- a forward-moving event on a closed pursuit still raises the
-- flag the first time, and clearing it by hand still means "I have seen this".
--
-- This file also carries unapplied_event_needs_review() and the rest of the
-- current sync_application_state() body, which reached the project without a
-- migration file behind them. A database built from this directory alone now
-- matches the deployed one.

begin;

-- ---------------------------------------------------------------------------
-- The rule, restated for SQL. REOPENS_A_PURSUIT in lib/jobs/review/flagging.ts
-- is the original; keep the two in step.
-- ---------------------------------------------------------------------------
create or replace function job_search.unapplied_event_needs_review(
  k job_search.application_event_kind
)
returns boolean
language sql
immutable
as $$
  select k in (
    'screen_scheduled',
    'assessment_sent',
    'interview_scheduled',
    'offer',
    'recruiter_reply'
  );
$$;

-- When you said you had seen it. Null means nobody has.
alter table job_search.application_events
  add column if not exists acknowledged_at timestamptz;

comment on column job_search.application_events.acknowledged_at is
  'Set when the conflict was acknowledged from the review queue. While it is set, sync_application_state() leaves needs_review alone.';

-- ---------------------------------------------------------------------------
-- sync_application_state, unchanged except for the acknowledgement check in
-- rule 1.
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
  v_flag boolean;
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

  select max(e.occurred_at) into v_override_seen_at
  from application_events e
  where e.application_id = p_application_id and e.kind = 'status_override';

  select coalesce(p.ghost_threshold_days, 30) into v_threshold
  from profiles p where p.id = v_user_id;
  v_threshold := coalesce(v_threshold, 30);

  for v_event in
    select e.id, e.kind, e.occurred_at, e.source, e.payload, e.acknowledged_at
    from application_events e
    where e.application_id = p_application_id
    order by e.occurred_at asc, e.created_at asc
  loop
    v_kind := v_event.kind;
    v_last_event_at := greatest(coalesce(v_last_event_at, v_event.occurred_at), v_event.occurred_at);

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

    if v_kind in ('recruiter_reply', 'screen_scheduled', 'assessment_sent',
                  'interview_scheduled', 'offer') then
      v_first_human_at := least(coalesce(v_first_human_at, v_event.occurred_at), v_event.occurred_at);
    end if;

    if v_kind = 'interview_scheduled' or v_kind = 'interview_completed' then
      v_last_interview_kind := coalesce(v_event.payload ->> 'interview_kind', v_last_interview_kind);
    end if;

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
    -- from an inbound email. Flag the event instead -- unless the flag has
    -- already been answered, in which case the answer stands.
    if job_search.is_terminal_application_status(v_status) then
      v_flag := job_search.unapplied_event_needs_review(v_kind)
                and v_event.acknowledged_at is null;
      update application_events set needs_review = v_flag
        where id = v_event.id
          and needs_review is distinct from v_flag;
      continue;
    end if;

    if job_search.application_status_rank(v_target) > job_search.application_status_rank(v_status) then
      v_status := v_target;
    end if;
  end loop;

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
         rejection_stage = coalesce(v_manual_rejection_stage, v_rejection_stage)
   where id = p_application_id;
end;
$$;

revoke all on function job_search.sync_application_state(uuid) from public, anon, authenticated;

commit;
