-- Core schema.
--
-- Conventions, applied without exception:
--   * every table has id uuid pk default gen_random_uuid(), created_at, updated_at
--     (exception: profiles.id is auth.users.id, one-to-one)
--   * every user-owned table has user_id uuid references auth.users not null
--   * money is integer cents, never numeric, never float
--   * applications.status is derived by job_search.sync_application_state() from
--     application_events, and is never written from a feature code path

set search_path = job_search, extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  -- interview times and "this week" depend on it
  timezone text not null default 'UTC',
  -- seeds relevance scoring during ingestion
  target_titles text[] not null default '{}',
  -- anchors every funnel time series
  search_started_on date,
  weekly_application_goal int,
  -- free text, injected into every generation prompt; see docs/EVIDENCE-LAYER.md
  writing_style_notes text,
  -- hard post-processing check on generated text. Seeded with em dashes.
  banned_constructions text[] not null default
    array['—', 'I am excited to', 'passionate about', 'leverage', 'deep dive',
          'at the intersection of'],
  -- days of silence before an application is treated as ghosted
  ghost_threshold_days int not null default 30,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_ghost_threshold_ck check (ghost_threshold_days between 7 and 180)
);

-- ---------------------------------------------------------------------------
-- companies
--
-- The organization. Stable across the whole search: notes, contacts and your
-- read on the place stay useful after a specific posting closes.
--
-- `domains` is what lets a message from a recruiter's personal work address
-- find its company, which matters here far more than in a commerce app because
-- recruiting mail arrives from ATS infrastructure domains that identify the
-- vendor and not the employer.
-- ---------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  domains text[] not null default '{}',
  ats_type ats_type not null default 'unknown',
  -- the board slug, so JD and question fetching works for later roles here
  ats_board_token text,
  careers_url text,
  website text,
  linkedin_url text,
  logo_url text,
  -- all nullable, all free text. Deliberately not a taxonomy.
  industry text,
  stage text,
  headcount_band text,
  hq_location text,
  priority company_priority not null default 'interested',
  -- markdown. The one long-form field, for what you know about the place.
  research text,
  status company_status not null default 'no_activity',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index companies_user_slug_key on companies (user_id, slug);
create index companies_user_idx on companies (user_id);
create index companies_domains_idx on companies using gin (domains);
create index companies_name_trgm_idx on companies using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- roles -- a specific posting. Facts about the job as advertised, which do not
-- change based on how your pursuit of it is going.
--
-- jd_text is retained in full, unlike email bodies. It is public information
-- fetched from a public page, it is the input to requirement extraction and
-- every draft, and refetching later usually fails because the posting is gone.
-- The privacy policy states this distinction explicitly.
-- ---------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  title text not null,
  jd_url text,
  jd_text text,
  jd_fetched_at timestamptz,
  -- sha1 of normalized jd_text; dedupes reposts
  jd_hash text,
  -- for refetching questions and detecting closure
  ats_job_id text,
  seniority text,
  location text,
  work_mode work_mode,
  comp_min_cents int,
  comp_max_cents int,
  comp_source comp_source,
  -- a closed posting with a live application is normal
  posting_status posting_status not null default 'unknown',
  source application_source not null default 'portal',
  first_seen_at timestamptz not null default now(),
  -- requirement extraction, computed once per JD. [{text, kind}]
  requirements jsonb,
  requirements_extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_comp_range_ck check (
    comp_min_cents is null or comp_max_cents is null or comp_max_cents >= comp_min_cents
  )
);

create index roles_user_idx on roles (user_id);
create index roles_company_idx on roles (company_id);
create index roles_ats_job_idx on roles (user_id, ats_job_id) where ats_job_id is not null;
create index roles_title_trgm_idx on roles using gin (title gin_trgm_ops);
create unique index roles_user_jd_hash_key
  on roles (user_id, company_id, jd_hash) where jd_hash is not null;

-- ---------------------------------------------------------------------------
-- applications -- your pursuit of a role.
--
-- Split off roles rather than putting status on the role because re-applying is
-- normal and roles get reposted. One row per pursuit preserves the previous
-- attempt's interview notes and rejection stage as history, and lets inbound
-- mail dated after the second attempt link to the second attempt.
-- ---------------------------------------------------------------------------
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references roles (id) on delete cascade,
  attempt int not null default 1,
  -- DERIVED. job_search.sync_application_state() owns this column.
  status application_status not null default 'lead',
  -- when set, wins over derivation. Cleared by any new linked email event.
  status_manual_override application_status,
  submitted_at timestamptz,
  source application_source not null default 'portal',
  referral_contact_id uuid,
  resume_version_id uuid,
  cover_letter_id uuid,
  created_by created_by_kind not null default 'manual',
  -- an email-inferred application always lands flagged
  needs_review boolean not null default false,
  confirmation_received_at timestamptz,
  -- the single most diagnostic timestamp in the app. Automated confirmations
  -- must never set it; see job_search.sync_application_state().
  first_human_response_at timestamptz,
  closed_at timestamptz,
  outcome application_outcome,
  -- the highest-value column in the schema: rejection at resume review and
  -- rejection after a final round are opposite diagnoses. Derived from the
  -- status the application was in when the rejection landed.
  rejection_stage rejection_stage,
  -- a hand correction. Wins over the inference above, and is the only way a
  -- human writes this fact.
  rejection_stage_override rejection_stage,
  excitement int,
  next_action text,
  next_action_due date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_attempt_ck check (attempt >= 1),
  constraint applications_excitement_ck check (excitement is null or excitement between 1 and 5)
);

create unique index applications_role_attempt_key on applications (role_id, attempt);
create index applications_user_idx on applications (user_id);
create index applications_role_idx on applications (role_id);
create index applications_status_idx on applications (user_id, status);
create index applications_submitted_idx on applications (user_id, submitted_at);

-- ---------------------------------------------------------------------------
-- application_events -- the timeline. Append only.
--
-- Status is derived from this table. Nothing writes applications.status
-- directly except the one function that reads these rows.
-- ---------------------------------------------------------------------------
create table application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  kind application_event_kind not null,
  occurred_at timestamptz not null default now(),
  source event_source not null default 'manual',
  ingested_message_id uuid,
  -- one line, generated for email events. Never the body.
  summary text,
  -- extracted structured detail, schema per kind
  payload jsonb,
  -- set when the event would have moved status backwards; the event is written,
  -- status is left alone, and this flags it for a human.
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index application_events_app_idx on application_events (application_id, occurred_at desc);
create index application_events_user_idx on application_events (user_id);
create index application_events_message_idx on application_events (ingested_message_id);

-- ---------------------------------------------------------------------------
-- interviews
-- ---------------------------------------------------------------------------
create table interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  round int not null default 1,
  kind interview_kind not null,
  scheduled_at timestamptz,
  duration_minutes int,
  format interview_format,
  status interview_status not null default 'scheduled',
  prep_notes text,
  debrief text,
  -- separate fields, because one blob gets written as a paragraph and never reread
  went_well text,
  went_poorly text,
  questions_asked text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interviews_app_idx on interviews (application_id, scheduled_at);
create index interviews_user_idx on interviews (user_id);

create table interview_participants (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews (id) on delete cascade,
  contact_id uuid not null,
  role participant_role not null default 'interviewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index interview_participants_key
  on interview_participants (interview_id, contact_id);
create index interview_participants_contact_idx on interview_participants (contact_id);

-- ---------------------------------------------------------------------------
-- contacts
--
-- STORE THE MINIMUM ABOUT OTHER PEOPLE. Name, title, public professional URL,
-- work email. No personal phone numbers, no personal addresses, nothing
-- scraped. This is other people's data in your database; it has no product
-- value beyond contacting them.
-- ---------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references companies (id) on delete set null,
  full_name text not null,
  title text,
  linkedin_url text,
  email text,
  relationship contact_relationship not null default 'cold',
  -- the specific tie, if any
  how_we_connect text,
  status contact_status not null default 'to_contact',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_user_idx on contacts (user_id);
create index contacts_company_idx on contacts (company_id);

alter table interview_participants
  add constraint interview_participants_contact_fk
  foreign key (contact_id) references contacts (id) on delete cascade;

alter table applications
  add constraint applications_referral_contact_fk
  foreign key (referral_contact_id) references contacts (id) on delete set null;

-- ---------------------------------------------------------------------------
-- contact_touches -- the outreach log. Response rate by message type is
-- knowable only if the sends are recorded, which is why this is MVP.
-- ---------------------------------------------------------------------------
create table contact_touches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  application_id uuid references applications (id) on delete set null,
  channel touch_channel not null default 'linkedin_dm',
  direction touch_direction not null default 'outbound',
  sent_at timestamptz not null default now(),
  message text,
  responded_at timestamptz,
  response_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_touches_contact_idx on contact_touches (contact_id, sent_at desc);
create index contact_touches_user_idx on contact_touches (user_id);

-- ---------------------------------------------------------------------------
-- resume_versions
-- ---------------------------------------------------------------------------
create table resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  storage_path text,
  -- extracted text, for grounding generated answers
  text_content text,
  is_default boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resume_versions_user_idx on resume_versions (user_id);
create unique index resume_versions_user_label_key on resume_versions (user_id, label);

alter table applications
  add constraint applications_resume_version_fk
  foreign key (resume_version_id) references resume_versions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- notes -- one table, attachable to anything, with integrity preserved.
--
-- A polymorphic entity_type + entity_id pair is the obvious alternative and it
-- is worse: no foreign keys, no cascade on delete, and RLS policies that cannot
-- express the parent check. Five nullable columns and one constraint cost
-- nothing and keep the database able to enforce its own invariants.
-- ---------------------------------------------------------------------------
create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  company_id uuid references companies (id) on delete cascade,
  role_id uuid references roles (id) on delete cascade,
  application_id uuid references applications (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  interview_id uuid references interviews (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_exactly_one_parent_ck check (
    num_nonnulls(company_id, role_id, application_id, contact_id, interview_id) = 1
  )
);

create index notes_user_idx on notes (user_id);
create index notes_company_idx on notes (company_id);
create index notes_role_idx on notes (role_id);
create index notes_application_idx on notes (application_id);
create index notes_contact_idx on notes (contact_id);
create index notes_interview_idx on notes (interview_id);

-- ---------------------------------------------------------------------------
-- attachments -- same five parents, same constraint. Supabase Storage.
-- ---------------------------------------------------------------------------
create table attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade,
  role_id uuid references roles (id) on delete cascade,
  application_id uuid references applications (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  interview_id uuid references interviews (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text,
  size_bytes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachments_exactly_one_parent_ck check (
    num_nonnulls(company_id, role_id, application_id, contact_id, interview_id) = 1
  )
);

create index attachments_user_idx on attachments (user_id);
create index attachments_role_idx on attachments (role_id);
create index attachments_application_idx on attachments (application_id);

-- ---------------------------------------------------------------------------
-- evidence_items -- the bank the writing layer draws on.
--
-- The quality ceiling of every draft the app produces is set here. Seed it
-- before building generation; no prompt engineering compensates for an empty
-- bank.
-- ---------------------------------------------------------------------------
create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- short handle, "rebuilt the close process"
  title text not null,
  -- the full story, in your own words
  body text not null,
  context text,
  skills text[] not null default '{}',
  metrics text,
  strength int not null default 3,
  -- incremented on use, so drafts rotate rather than repeat
  used_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_strength_ck check (strength between 1 and 5)
);

create index evidence_items_user_idx on evidence_items (user_id);
create index evidence_items_skills_idx on evidence_items using gin (skills);

-- ---------------------------------------------------------------------------
-- questions -- the question bank, deduped across applications by fingerprint.
-- ---------------------------------------------------------------------------
create table questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- as asked, the first time it was seen
  text text not null,
  -- sha1 of the normalized text; see lib/fingerprint.ts
  fingerprint text not null,
  kind question_kind not null default 'other',
  -- your approved reusable version
  canonical_answer text,
  canonical_answer_updated_at timestamptz,
  times_seen int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index questions_user_fingerprint_key on questions (user_id, fingerprint);
create index questions_user_idx on questions (user_id);
create index questions_text_trgm_idx on questions using gin (text gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- application_answers -- the per-application instance.
-- evidence_item_ids is the grounding record: an answer that cites nothing was
-- not grounded, and the evidence layer treats that as an error rather than a
-- fallback.
-- ---------------------------------------------------------------------------
create table application_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  answer text,
  status answer_status not null default 'draft',
  generated_from_question_id uuid references questions (id) on delete set null,
  word_limit int,
  evidence_item_ids uuid[] not null default '{}',
  -- claims the model could not ground in a retrieved evidence item
  unsupported_claims text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index application_answers_key on application_answers (application_id, question_id);
create index application_answers_user_idx on application_answers (user_id);

-- ---------------------------------------------------------------------------
-- cover_letters
-- ---------------------------------------------------------------------------
create table cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  body text,
  status answer_status not null default 'draft',
  evidence_item_ids uuid[] not null default '{}',
  -- The shareable case page. Unguessable, expiring, noindex.
  public_slug text,
  public_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index cover_letters_slug_key on cover_letters (public_slug) where public_slug is not null;
create index cover_letters_user_idx on cover_letters (user_id);
create index cover_letters_application_idx on cover_letters (application_id);

alter table applications
  add constraint applications_cover_letter_fk
  foreign key (cover_letter_id) references cover_letters (id) on delete set null;

-- ---------------------------------------------------------------------------
-- email_accounts
-- ---------------------------------------------------------------------------
create table email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider email_provider not null,
  email_address text not null,
  -- ciphertext only. See lib/crypto/tokens.ts; plaintext must never land here.
  oauth_refresh_token text,
  oauth_access_token text,
  token_expires_at timestamptz,
  -- Gmail historyId
  sync_cursor text,
  sync_page_token text,
  last_synced_at timestamptz,
  status email_account_status not null default 'active',
  -- 90 days by default: an active search generates most of its useful mail in
  -- the last quarter, and going back further mostly imports noise.
  backfill_window_days int not null default 90,
  backfill_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_accounts_backfill_window_ck
    check (backfill_window_days between 30 and 730)
);

create unique index email_accounts_user_address_key
  on email_accounts (user_id, lower(email_address));
create index email_accounts_user_idx on email_accounts (user_id);

-- ---------------------------------------------------------------------------
-- ingested_messages -- the audit + dedupe log. THE BODY IS NEVER STORED.
--
-- Subject retention rule: the pipeline scans far more mail than it keeps. For
-- 'not_relevant', only the message id, received_at and classification are
-- written -- that row exists solely to skip the message on the next sync. The
-- constraint enforces it rather than trusting every write path to remember.
-- ---------------------------------------------------------------------------
create table ingested_messages (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references email_accounts (id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  received_at timestamptz,
  from_address text,
  -- more informative than `from` for recruiting mail, and captured for that reason
  reply_to_address text,
  subject text,
  classification message_classification,
  parse_status parse_status not null default 'pending',
  parse_confidence numeric(3, 2),
  parser_version text,
  resulting_application_id uuid references applications (id) on delete set null,
  -- how the linker decided, and how sure it was
  link_confidence numeric(3, 2),
  link_method text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingested_confidence_ck check (
    parse_confidence is null or parse_confidence between 0 and 1
  ),
  constraint ingested_link_confidence_ck check (
    link_confidence is null or link_confidence between 0 and 1
  ),
  constraint ingested_not_relevant_is_bare_ck check (
    classification is distinct from 'not_relevant'
    or (subject is null and from_address is null and reply_to_address is null
        and thread_id is null)
  )
);

-- What makes re-running a sync safe.
create unique index ingested_messages_provider_key
  on ingested_messages (email_account_id, provider_message_id);
create index ingested_messages_account_idx on ingested_messages (email_account_id);
create index ingested_messages_application_idx on ingested_messages (resulting_application_id);
create index ingested_messages_thread_idx on ingested_messages (email_account_id, thread_id)
  where thread_id is not null;

alter table application_events
  add constraint application_events_message_fk
  foreign key (ingested_message_id) references ingested_messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- sync_jobs -- powers the sync progress UI; backfill takes minutes
-- ---------------------------------------------------------------------------
create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references email_accounts (id) on delete cascade,
  type sync_job_type not null,
  status sync_job_status not null default 'queued',
  messages_seen int not null default 0,
  messages_classified int not null default 0,
  messages_parsed int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_jobs_account_idx on sync_jobs (email_account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reminders -- generated by rules, creatable by hand
-- ---------------------------------------------------------------------------
create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references applications (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  kind reminder_kind not null default 'custom',
  due_at timestamptz not null,
  completed_at timestamptz,
  body text not null,
  -- rule-generated reminders are idempotent on this key
  rule_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_user_due_idx on reminders (user_id, due_at) where completed_at is null;
create unique index reminders_rule_key on reminders (user_id, rule_key) where rule_key is not null;
