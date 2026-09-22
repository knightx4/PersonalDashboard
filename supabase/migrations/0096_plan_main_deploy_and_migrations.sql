-- Two more readings beside main's CI: whether main deployed, and whether the
-- migrations on main are applied to this database.
--
-- Green CI said nothing about either. CI builds its own database from the
-- files, so a merged migration nobody applied passes while the deployed app
-- reads a column that is not here, which CLAUDE.md records as the failure
-- that has broken pages in this repository more than once. And a commit can
-- pass CI and still not be what is running, when the Vercel deploy fails.
--
-- Both are written by the same tick as the CI reading (`lib/plan/ci.ts`
-- `refreshMainCheck`) into the same row, so the panel reads one row as before.
--
--   deploy_state   what GitHub's deployment record for main's head says:
--                  deployed | deploying | failed | missing (see lib/plan/deploy.ts)
--   deploy_url     the deployment's own page, for the panel to link to
--   deploy_error   why the reading could not be taken, in refusalFor's sentence
--   unapplied_migrations  files on main no applied name records; empty when
--                  every one is applied, null when the reading was not taken
--   migrations_error      why that reading could not be taken
--
-- `applied_migration_names()` is how the tick reads the live history. The
-- history lives in `supabase_migrations`, which PostgREST does not expose,
-- and exposing a schema for one list of names would be more surface than the
-- question needs. Security definer, owned by postgres, executable by the
-- service role only: the tick runs as the service role and nothing in a
-- browser has any business asking.

set search_path = public, extensions;

alter table plan_main_checks add column if not exists deploy_state text;
alter table plan_main_checks add column if not exists deploy_url text;
alter table plan_main_checks add column if not exists deploy_error text;
alter table plan_main_checks add column if not exists unapplied_migrations text[];
alter table plan_main_checks add column if not exists migrations_error text;

alter table plan_main_checks drop constraint if exists plan_main_checks_deploy_state_ck;
alter table plan_main_checks add constraint plan_main_checks_deploy_state_ck check (
  deploy_state is null or deploy_state in ('deployed', 'deploying', 'failed', 'missing')
);
alter table plan_main_checks drop constraint if exists plan_main_checks_deploy_url_length_ck;
alter table plan_main_checks add constraint plan_main_checks_deploy_url_length_ck
  check (deploy_url is null or length(deploy_url) <= 300);
alter table plan_main_checks drop constraint if exists plan_main_checks_deploy_error_length_ck;
alter table plan_main_checks add constraint plan_main_checks_deploy_error_length_ck
  check (deploy_error is null or length(deploy_error) <= 500);
alter table plan_main_checks drop constraint if exists plan_main_checks_unapplied_count_ck;
alter table plan_main_checks add constraint plan_main_checks_unapplied_count_ck
  check (unapplied_migrations is null or cardinality(unapplied_migrations) <= 50);
alter table plan_main_checks drop constraint if exists plan_main_checks_migrations_error_length_ck;
alter table plan_main_checks add constraint plan_main_checks_migrations_error_length_ck
  check (migrations_error is null or length(migrations_error) <= 500);

comment on column plan_main_checks.deploy_state is
  'deployed | deploying | failed | missing, from lib/plan/deploy.ts. Null when the reading was not taken.';
comment on column plan_main_checks.deploy_url is
  'The deployment''s page on Vercel for main''s head, for the panel to link to.';
comment on column plan_main_checks.deploy_error is
  'Why the deploy reading could not be taken. Null when it was.';
comment on column plan_main_checks.unapplied_migrations is
  'Migration files on main that no applied name records, as folder/file. Empty when all are applied; null when not read.';
comment on column plan_main_checks.migrations_error is
  'Why the migrations reading could not be taken. Null when it was.';

create or replace function public.applied_migration_names()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- plpgsql rather than sql so the body is resolved when called rather than
  -- when created: the local test database has no supabase_migrations schema,
  -- and this has to apply there too.
  return query select m.name from supabase_migrations.schema_migrations m where m.name is not null;
end
$$;

comment on function public.applied_migration_names() is
  'The names in the live migration history, for the overnight tick to compare with the files on main. Service role only.';

revoke all on function public.applied_migration_names() from public, anon, authenticated;
grant execute on function public.applied_migration_names() to service_role;
