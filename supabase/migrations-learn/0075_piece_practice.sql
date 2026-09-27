-- The practice task in a piece, and what was handed in for it (plan #1142).
--
-- A piece of a learning goal's plan has one hands-on task between its lessons
-- and its check, such as working out net revenue retention from a small
-- table. Sonnet writes the task when the piece is first opened; Haiku marks
-- each hand-in point by point against what the task said a complete answer
-- has. A piece is passed only when a hand-in has met every point and its
-- check has been answered right.
--
-- learn.piece_practice, one task per piece:
--   task             what to do, in a few sentences.
--   data             a small table the task works from, as
--                    {"columns": [..], "rows": [[..], ..]}, or null.
--   figures          the key figures to type in, as [{"label", "unit"}], or
--                    [] when the task wants only written working.
--   points           what a complete hand-in has, one line each. Marked one
--                    by one, and all of them must be met to pass.
--   worked           a worked answer, shown once the practice is passed.
--   spreadsheet_note when the skill is normally done in a spreadsheet, what
--                    typing the figures into the page leaves out. Kept to
--                    learn which tasks the page cannot carry (the feature's
--                    open question on hand-in by file).
--
-- learn.piece_practice_handins, one row per hand-in, written once marked:
--   answer, figures  what they typed: working and the figures by label.
--   marks            [{"point", "met", "note"}], one per point.
--   passed           every point met.
--
-- Both go with the piece.

set search_path = learn, public, extensions;

create table if not exists learn.piece_practice (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null,

  task text not null,
  data jsonb,
  figures jsonb not null default '[]'::jsonb,
  points text[] not null,
  worked text not null,
  spreadsheet_note text,

  -- The model that wrote the task, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint piece_practice_piece_fk
    foreign key (piece_id, user_id) references learn.plan_pieces (id, user_id) on delete cascade,
  constraint piece_practice_piece_uq unique (piece_id),
  -- The composite key a hand-in's foreign key needs.
  constraint piece_practice_id_user_uq unique (id, user_id),
  constraint piece_practice_text_ck check (btrim(task) <> '' and btrim(worked) <> ''),
  constraint piece_practice_points_ck check (cardinality(points) between 1 and 8),
  constraint piece_practice_figures_ck check (jsonb_typeof(figures) = 'array'),
  constraint piece_practice_data_ck check (data is null or jsonb_typeof(data) = 'object')
);

create index if not exists piece_practice_user_idx on learn.piece_practice (user_id);

create table if not exists learn.piece_practice_handins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  practice_id uuid not null,

  answer text not null default '',
  figures jsonb not null default '[]'::jsonb,
  marks jsonb not null,
  passed boolean not null,

  -- The model that marked it.
  mark_model text,
  created_at timestamptz not null default now(),

  constraint piece_practice_handins_practice_fk
    foreign key (practice_id, user_id) references learn.piece_practice (id, user_id) on delete cascade,
  constraint piece_practice_handins_marks_ck check (jsonb_typeof(marks) = 'array'),
  constraint piece_practice_handins_figures_ck check (jsonb_typeof(figures) = 'array'),
  -- Something was handed in: working, or at least one figure.
  constraint piece_practice_handins_some_ck check (btrim(answer) <> '' or jsonb_array_length(figures) > 0)
);

create index if not exists piece_practice_handins_user_idx on learn.piece_practice_handins (user_id);
create index if not exists piece_practice_handins_practice_idx
  on learn.piece_practice_handins (practice_id, created_at desc);

alter table learn.piece_practice enable row level security;
alter table learn.piece_practice_handins enable row level security;

drop policy if exists piece_practice_all on learn.piece_practice;
create policy piece_practice_all on learn.piece_practice for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists piece_practice_handins_all on learn.piece_practice_handins;
create policy piece_practice_handins_all on learn.piece_practice_handins for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.piece_practice from anon;
revoke all on learn.piece_practice_handins from anon;
-- Written from the piece's page with the person's session: the task once,
-- and each hand-in once it is marked. Neither is edited afterwards.
grant select, insert on learn.piece_practice to authenticated;
grant select, insert on learn.piece_practice_handins to authenticated;
grant select, insert, update, delete on learn.piece_practice to service_role;
grant select, insert, update, delete on learn.piece_practice_handins to service_role;

comment on table learn.piece_practice is
  'The hands-on task in each piece of a learning goal''s plan, with the points a complete hand-in has (plan #1142).';
comment on table learn.piece_practice_handins is
  'What was handed in for a piece''s practice task, marked point by point (plan #1142).';
