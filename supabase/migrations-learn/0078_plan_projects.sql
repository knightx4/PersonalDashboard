-- The final project that ends a learning goal's plan, and what was handed in
-- for it (plan #1146).
--
-- Each plan ends with one larger task that uses the whole course, such as
-- working out a SaaS company's retention and CAC payback from its figures.
-- Sonnet writes the brief from the plan's outline the first time the plan
-- page opens; Haiku marks each hand-in point by point against what the brief
-- said a complete hand-in has. The plan is finished when a hand-in has met
-- every point and every piece of every unit is passed.
--
-- The project hangs off the track, not a unit: units can be moved, removed
-- and added (plan #1144), and the project stays with the plan through that.
--
-- learn.plan_projects, one per goal's track:
--   title            a short name for the project.
--   task             the brief, in a few paragraphs.
--   data             a table the brief works from, as
--                    {"columns": [..], "rows": [[..], ..]}, or null.
--   figures          the key figures to type in, as [{"label", "unit"}], or
--                    [] when the brief wants only written work.
--   points           what a complete hand-in has, one line each. Marked one
--                    by one, and all of them must be met to pass.
--   worked           a worked answer, shown once the project is passed.
--   spreadsheet_note when the work is normally done in a spreadsheet, what
--                    typing it into the page leaves out, as on a piece's
--                    practice task (learn 0075).
--
-- learn.plan_project_handins, one row per hand-in, written once marked:
--   answer, figures  what they typed: working and the figures by label.
--   marks            [{"point", "met", "note"}], one per point.
--   passed           every point met.
--
-- Both go with the track.

set search_path = learn, public, extensions;

create table if not exists learn.plan_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  title text not null,
  task text not null,
  data jsonb,
  figures jsonb not null default '[]'::jsonb,
  points text[] not null,
  worked text not null,
  spreadsheet_note text,

  -- The model that wrote the brief, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint plan_projects_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint plan_projects_subject_uq unique (subject_id),
  -- The composite key a hand-in's foreign key needs.
  constraint plan_projects_id_user_uq unique (id, user_id),
  constraint plan_projects_text_ck check (btrim(title) <> '' and btrim(task) <> '' and btrim(worked) <> ''),
  constraint plan_projects_points_ck check (cardinality(points) between 1 and 10),
  constraint plan_projects_figures_ck check (jsonb_typeof(figures) = 'array'),
  constraint plan_projects_data_ck check (data is null or jsonb_typeof(data) = 'object')
);

create index if not exists plan_projects_user_idx on learn.plan_projects (user_id);

create table if not exists learn.plan_project_handins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null,

  answer text not null default '',
  figures jsonb not null default '[]'::jsonb,
  marks jsonb not null,
  passed boolean not null,

  -- The model that marked it.
  mark_model text,
  created_at timestamptz not null default now(),

  constraint plan_project_handins_project_fk
    foreign key (project_id, user_id) references learn.plan_projects (id, user_id) on delete cascade,
  constraint plan_project_handins_marks_ck check (jsonb_typeof(marks) = 'array'),
  constraint plan_project_handins_figures_ck check (jsonb_typeof(figures) = 'array'),
  -- Something was handed in: working, or at least one figure.
  constraint plan_project_handins_some_ck check (btrim(answer) <> '' or jsonb_array_length(figures) > 0)
);

create index if not exists plan_project_handins_user_idx on learn.plan_project_handins (user_id);
create index if not exists plan_project_handins_project_idx
  on learn.plan_project_handins (project_id, created_at desc);

alter table learn.plan_projects enable row level security;
alter table learn.plan_project_handins enable row level security;

drop policy if exists plan_projects_all on learn.plan_projects;
create policy plan_projects_all on learn.plan_projects for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists plan_project_handins_all on learn.plan_project_handins;
create policy plan_project_handins_all on learn.plan_project_handins for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.plan_projects from anon;
revoke all on learn.plan_project_handins from anon;
-- Written from the plan page with the person's session: the brief once, and
-- each hand-in once it is marked. Neither is edited afterwards.
grant select, insert on learn.plan_projects to authenticated;
grant select, insert on learn.plan_project_handins to authenticated;
grant select, insert, update, delete on learn.plan_projects to service_role;
grant select, insert, update, delete on learn.plan_project_handins to service_role;

comment on table learn.plan_projects is
  'The final project that ends each learning goal''s plan, with the points a complete hand-in has (plan #1146).';
comment on table learn.plan_project_handins is
  'What was handed in for a plan''s final project, marked point by point (plan #1146).';
