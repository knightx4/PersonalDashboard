-- The schema, the extensions, and the enum types.
--
-- Everything this app owns lives in `job_search`, not `public`.
--
-- The reason is cost, and it is not marginal: Supabase bills per PROJECT, not
-- per app, so N apps in N schemas of one project cost what one app costs. It is
-- also the only way this app can share a project with Shopping Manager at all —
-- the two schemas collide on four table names (profiles, email_accounts,
-- ingested_messages, sync_jobs), six enum type names, and two function names.
--
-- `create type` and `create trigger` fail loudly on a duplicate, but
-- `create or replace function` succeeds SILENTLY. Applied to `public`, these
-- migrations would overwrite Shopping Manager's handle_new_user() and
-- touch_updated_at() and then abort at the first enum, leaving a half-applied
-- migration on a live database. In their own schema, none of that can happen.
--
-- What is deliberately shared is `auth.users`: one login across every app in
-- the project. That is the whole point of the arrangement.

create schema if not exists job_search;

-- Already present on a Supabase project; created here so the local test
-- database and a fresh project both work from the same files.
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Unqualified names in this file resolve into job_search; pg_trgm's operators
-- resolve from `extensions`, where Supabase keeps them. Role-title similarity
-- in the linker depends on that being reachable.
set search_path = job_search, extensions;

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------
create type email_provider as enum ('gmail', 'outlook');

create type email_account_status as enum ('active', 'needs_reauth', 'disconnected', 'error');

-- job_alert is its own label on purpose: board digests match every keyword in
-- the candidate query and mean nothing. Labelling them explicitly keeps them
-- out of the review queue instead of drowning it.
create type message_classification as enum (
  'application_confirmation',
  'rejection',
  'recruiter_outreach',
  'recruiter_reply',
  'interview_invite',
  'scheduling',
  'assessment',
  'offer',
  'networking',
  'job_alert',
  'not_relevant'
);

create type parse_status as enum ('pending', 'parsed', 'failed', 'skipped', 'needs_review');

create type sync_job_type as enum ('backfill', 'incremental');

create type sync_job_status as enum ('queued', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- Companies and roles
-- ---------------------------------------------------------------------------
create type ats_type as enum (
  'greenhouse', 'lever', 'ashby', 'workday', 'icims', 'smartrecruiters',
  'workable', 'taleo', 'jobvite', 'bamboohr', 'breezy', 'rippling',
  'wellfound', 'linkedin', 'indeed', 'other', 'unknown'
);

create type company_priority as enum ('target', 'interested', 'backup', 'passed');

create type company_status as enum ('no_activity', 'active', 'closed_out');

create type work_mode as enum ('onsite', 'hybrid', 'remote');

create type comp_source as enum ('posted', 'recruiter', 'estimate');

create type posting_status as enum ('open', 'closed', 'unknown');

-- Drives the by-channel funnel, which is the whole diagnostic point.
create type application_source as enum (
  'portal', 'linkedin', 'referral', 'recruiter_inbound', 'job_board',
  'direct_outreach', 'other'
);

-- ---------------------------------------------------------------------------
-- Applications
--
-- Derived from application_events by public.sync_application_state(). Nothing
-- else writes it. 'ghosted' is NOT in this enum on purpose -- it is a view over
-- last-event age, computed in lib/pipeline.ts and by the ghost sweep, never a
-- state you can enter by hand.
-- ---------------------------------------------------------------------------
create type application_status as enum (
  'lead',
  'drafting',
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
  'role_closed'
);

create type application_outcome as enum (
  'rejected', 'withdrawn', 'ghosted', 'offer_declined', 'offer_accepted', 'role_closed'
);

create type rejection_stage as enum (
  'pre_screen', 'resume_review', 'recruiter_screen', 'hiring_manager',
  'technical', 'onsite', 'final', 'offer_stage', 'unknown'
);

create type created_by_kind as enum ('manual', 'email_inferred');

create type application_event_kind as enum (
  'submitted', 'confirmation', 'recruiter_reply', 'screen_scheduled',
  'assessment_sent', 'assessment_submitted', 'interview_scheduled',
  'interview_completed', 'offer', 'rejection', 'withdrawal',
  'follow_up_sent', 'status_override', 'note'
);

create type event_source as enum ('email', 'manual', 'system');

-- ---------------------------------------------------------------------------
-- Interviews, contacts
-- ---------------------------------------------------------------------------
create type interview_kind as enum (
  'recruiter_screen', 'hiring_manager', 'technical', 'case', 'panel',
  'onsite', 'final', 'informal'
);

create type interview_format as enum ('phone', 'video', 'onsite');

create type interview_status as enum ('scheduled', 'completed', 'cancelled', 'rescheduled');

create type participant_role as enum ('interviewer', 'coordinator', 'observer');

create type contact_relationship as enum (
  'cold', 'alum', 'second_degree', 'former_colleague', 'friend', 'recruiter', 'interviewer'
);

create type contact_status as enum ('to_contact', 'contacted', 'responded', 'met', 'dormant');

create type touch_channel as enum ('linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other');

create type touch_direction as enum ('outbound', 'inbound');

-- ---------------------------------------------------------------------------
-- Writing layer (tables exist in the MVP; see docs/EVIDENCE-LAYER.md, which
-- adds columns to `roles` for the match and nothing else)
-- ---------------------------------------------------------------------------
create type question_kind as enum (
  'motivation', 'fit', 'behavioral', 'technical', 'logistics', 'demographic', 'other'
);

create type answer_status as enum ('draft', 'approved', 'submitted');

create type reminder_kind as enum ('follow_up', 'prep', 'thank_you', 'deadline', 'custom');
