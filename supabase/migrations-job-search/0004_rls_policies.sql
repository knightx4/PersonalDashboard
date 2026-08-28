-- Row level security.
--
-- RLS is the entire multi-tenancy story. Every table holding user data has it
-- enabled -- not most, every one. The cross-user isolation test in
-- tests/rls.test.ts loops over the table list and fails automatically if a new
-- table shows up without a policy.
--
-- Child tables without their own user_id reach the owner through their parent.
-- Every such foreign key is indexed in 0002, or these get slow fast.
--
-- There are no shared reference tables in this schema. Unlike the commerce
-- app's merchants, `companies` are user-scoped: which employers you are
-- pursuing is exactly the kind of fact that must not leak between tenants.

set search_path = job_search, extensions;

-- PostgREST needs USAGE on the schema for every role that might reach it, or
-- requests fail before RLS is ever consulted and the error is unreadable. Table
-- privileges are what actually gate access, and anon gets none: an
-- unauthenticated request gets a permission error, not an empty result set that
-- looks like "no data".
grant usage on schema job_search to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema job_search to authenticated;
grant all on all tables in schema job_search to service_role;
grant all on all sequences in schema job_search to service_role;

revoke all on all tables in schema job_search from anon;

-- Anything added later inherits the same shape rather than relying on whoever
-- writes the next migration remembering.
alter default privileges in schema job_search
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema job_search
  grant all on tables to service_role;

alter table profiles               enable row level security;
alter table companies              enable row level security;
alter table roles                  enable row level security;
alter table applications           enable row level security;
alter table application_events     enable row level security;
alter table interviews             enable row level security;
alter table interview_participants enable row level security;
alter table contacts               enable row level security;
alter table contact_touches        enable row level security;
alter table resume_versions        enable row level security;
alter table notes                  enable row level security;
alter table attachments            enable row level security;
alter table evidence_items         enable row level security;
alter table questions              enable row level security;
alter table application_answers    enable row level security;
alter table cover_letters          enable row level security;
alter table email_accounts         enable row level security;
alter table ingested_messages      enable row level security;
alter table sync_jobs              enable row level security;
alter table reminders              enable row level security;

-- ---------------------------------------------------------------------------
-- profiles -- keyed to auth.users.id rather than a user_id column
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No insert policy: profiles are created by the on_auth_user_created trigger.
-- No delete policy: profiles die with the auth.users row.

-- ---------------------------------------------------------------------------
-- Standard owner policies: user_id = auth.uid()
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'roles', 'applications', 'application_events', 'interviews',
    'contacts', 'contact_touches', 'resume_versions', 'notes', 'attachments',
    'evidence_items', 'questions', 'application_answers', 'cover_letters',
    'email_accounts', 'reminders'
  ] loop
    execute format(
      'create policy %I on job_search.%I for select to authenticated
         using (user_id = (select auth.uid()))', t || '_select', t);
    execute format(
      'create policy %I on job_search.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format(
      'create policy %I on job_search.%I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format(
      'create policy %I on job_search.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t || '_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Child tables -- ownership through the parent
-- ---------------------------------------------------------------------------
create policy interview_participants_all on interview_participants for all to authenticated
  using (exists (
    select 1 from interviews i
    where i.id = interview_participants.interview_id and i.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from interviews i
    where i.id = interview_participants.interview_id and i.user_id = (select auth.uid())
  ));

create policy ingested_messages_all on ingested_messages for all to authenticated
  using (exists (
    select 1 from email_accounts ea
    where ea.id = ingested_messages.email_account_id
      and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from email_accounts ea
    where ea.id = ingested_messages.email_account_id
      and ea.user_id = (select auth.uid())
  ));

create policy sync_jobs_all on sync_jobs for all to authenticated
  using (exists (
    select 1 from email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Cross-parent integrity.
--
-- RLS stops user B *reading* user A's application. It does not stop user B
-- INSERTING a row of their own that points at it: `user_id = auth.uid()` is
-- satisfied by the child row, and the parent id is never checked. That is a
-- real corruption path -- an application_events row written against someone
-- else's application would silently rewrite their derived status -- so the
-- parent-ownership check is enforced in the database, once, for every table
-- that references another user-owned row.
--
-- Written against to_jsonb(new) so one function serves tables with different
-- subsets of these columns.
-- ---------------------------------------------------------------------------
create or replace function job_search.assert_parents_same_owner()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parents text[][] := array[
    ['company_id', 'companies'],
    ['role_id', 'roles'],
    ['application_id', 'applications'],
    ['contact_id', 'contacts'],
    ['referral_contact_id', 'contacts'],
    ['interview_id', 'interviews'],
    ['question_id', 'questions'],
    ['generated_from_question_id', 'questions'],
    ['resume_version_id', 'resume_versions'],
    ['cover_letter_id', 'cover_letters']
  ];
  v_col text;
  v_table text;
  v_value uuid;
  v_owner uuid;
  i int;
begin
  for i in 1 .. array_length(v_parents, 1) loop
    v_col := v_parents[i][1];
    v_table := v_parents[i][2];

    if not (v_row ? v_col) or v_row ->> v_col is null then
      continue;
    end if;

    v_value := (v_row ->> v_col)::uuid;
    execute format('select user_id from job_search.%I where id = $1', v_table)
      into v_owner using v_value;

    if v_owner is distinct from new.user_id then
      raise exception 'parent % belongs to another user', replace(v_col, '_id', '')
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'roles', 'applications', 'application_events', 'interviews', 'contacts',
    'contact_touches', 'notes', 'attachments', 'application_answers',
    'cover_letters', 'reminders'
  ] loop
    execute format(
      'create trigger %I before insert or update on job_search.%I
         for each row execute function job_search.assert_parents_same_owner()',
      t || '_same_owner', t
    );
  end loop;
end;
$$;

-- interview_participants has no user_id of its own; both sides reach a user
-- through their parents, so it gets a check of its own shape.
create or replace function job_search.assert_interview_participant_same_owner()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
declare
  v_interview_owner uuid;
  v_contact_owner uuid;
begin
  select user_id into v_interview_owner from interviews where id = new.interview_id;
  select user_id into v_contact_owner from contacts where id = new.contact_id;
  if v_interview_owner is distinct from v_contact_owner then
    raise exception 'interview and contact belong to different users'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger interview_participants_same_owner
  before insert or update on interview_participants
  for each row execute function job_search.assert_interview_participant_same_owner();
