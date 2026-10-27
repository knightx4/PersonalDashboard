-- The projects Dev builds outside this app, as rows (plan #2553.1).
--
-- A project was an entry in the PROJECTS array in lib/plan/projects.ts, so
-- adding one, renaming one or putting one away took a deploy. This table holds
-- them instead: lib/plan/projects.ts reads the account's rows, and each active
-- row gets its own section on /dev/plan and a page at /dev/projects/<id>.
--
-- `id` is the slug a plan row's `module` column names the project by, the
-- same text column a workspace id goes in (migration 0051). It is per
-- account, so the key is (user_id, id). It must not be a workspace id; the
-- loader drops a row that is, since the plan would file its steps under the
-- workspace.
--
-- `routine_id_env` and `routine_token_env` name the environment variables
-- holding the routine that builds the project. They are the website's pair,
-- kept as an override until every project goes through one shared routine
-- (plan #2553.3); a row with neither set has no routine of its own yet.
--
-- The only row written is the website's, for the owner's account. Nothing
-- else in any account is read or changed.

set search_path = public, extensions;

create table if not exists dev_projects (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What the plan page and the project page call it.
  label text not null,
  -- The line under the label.
  description text not null default '',
  -- Where the steps are built, as GitHub names it.
  owner text not null,
  repo text not null,
  branch text not null default 'main',
  -- The site the repository deploys, when it deploys one.
  url text,
  -- The skill in the project's repository that says how a step is built.
  skill text not null default '.claude/skills/plan/SKILL.md',
  -- The command a session runs there before pushing, when the repository has one.
  check_command text,
  -- When the repository was made ready for Dash to build in.
  set_up_at timestamptz,
  -- When it was put away. An archived project draws no section.
  archived_at timestamptz,
  routine_id_env text,
  routine_token_env text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- A slug that fits plan_items.module, which holds at most 40 characters.
  constraint dev_projects_id_ck check (id ~ '^[a-z][a-z0-9-]{0,39}$'),
  constraint dev_projects_label_ck check (length(btrim(label)) between 1 and 80),
  constraint dev_projects_description_ck check (length(description) <= 200),
  constraint dev_projects_owner_ck check (owner ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  constraint dev_projects_repo_ck check (repo ~ '^[A-Za-z0-9._-]{1,100}$'),
  constraint dev_projects_branch_ck check (length(branch) between 1 and 200),
  constraint dev_projects_url_ck check (url is null or url ~ '^https?://'),
  constraint dev_projects_check_command_ck check (
    check_command is null or length(check_command) between 1 and 500
  ),
  -- Both names or neither: an id with no token cannot fire a routine.
  constraint dev_projects_routine_env_ck check (
    (routine_id_env is null) = (routine_token_env is null)
  )
);

comment on table dev_projects is
  'Projects Dev builds outside this app. A plan row whose module is a project id is built in that project''s repository (lib/plan/projects.ts).';

drop trigger if exists dev_projects_touch_updated_at on dev_projects;
create trigger dev_projects_touch_updated_at
  before update on dev_projects
  for each row execute function public.touch_updated_at();

alter table dev_projects enable row level security;

drop policy if exists dev_projects_select on dev_projects;
create policy dev_projects_select on dev_projects for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists dev_projects_insert on dev_projects;
create policy dev_projects_insert on dev_projects for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists dev_projects_update on dev_projects;
create policy dev_projects_update on dev_projects for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists dev_projects_delete on dev_projects;
create policy dev_projects_delete on dev_projects for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on dev_projects to authenticated;
revoke all on table dev_projects from anon;

-- The website, as it was in the array, for the owner alone. A database without
-- that account (the local test one) gets no row.
insert into dev_projects (
  id, user_id, label, description, owner, repo, branch, url, skill,
  set_up_at, routine_id_env, routine_token_env
)
select
  'website', u.id, 'selveyknight.com', 'The personal website', 'knightx4',
  'selveyknightwebsite', 'main', 'https://selveyknight.com', '.claude/skills/plan/SKILL.md',
  now(), 'CLAUDE_WEBSITE_ROUTINE_ID', 'CLAUDE_WEBSITE_ROUTINE_TOKEN'
from auth.users u
where u.id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
on conflict (user_id, id) do nothing;
