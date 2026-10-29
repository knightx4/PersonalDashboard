-- Ready-made panels of advisors for the board (plan #2561.12, under #2561).
--
-- A panel is a named group of advisors the person picks in one press when
-- asking a question: Money, Career, Building, Life. `advisors` holds the
-- advisors' keys (you.board_advisors.key), seats and guests alike. Picking a
-- panel on a question writes those keys into the question's own `advisors`,
-- which tells the chair whom to seat; the panel is not remembered on the
-- question, so editing or deleting it later changes nothing already asked.
--
-- The five seats still join every question. board_questions.seats_off lists
-- the seats the person turned off for that one question.
--
-- Schema change, plus the four panels seeded for the owner only, where the
-- owner's account exists. No existing row of anyone else is touched.

set search_path = you, public, extensions;

create table you.board_panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  advisors text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint board_panels_advisors_ck check (cardinality(advisors) <= 12),
  constraint board_panels_id_user_id_key unique (id, user_id)
);

comment on table you.board_panels is
  'Named groups of advisors the person picks when asking the board a question, as keys into board_advisors (plan #2561.12).';

create unique index board_panels_name_key on you.board_panels (user_id, lower(name));

create trigger board_panels_touch_updated_at
  before update on you.board_panels
  for each row execute function you.touch_updated_at();

alter table you.board_panels enable row level security;

create policy board_panels_all on you.board_panels for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.board_panels from anon, authenticated;
grant select, insert, update, delete on you.board_panels to authenticated, service_role;

alter table you.board_questions
  add column seats_off text[] not null default '{}';

alter table you.board_questions
  add constraint board_questions_seats_off_ck
  check (seats_off <@ array['hiring_manager', 'mentor', 'skeptic', 'cfo', 'dreamer']::text[]);

comment on column you.board_questions.seats_off is
  'Seats the person turned off for this question; the other seats sit as always (plan #2561.12).';

insert into you.board_panels (user_id, name, advisors)
select u.id, p.name, p.advisors
from auth.users u
cross join (values
  ('Money', array['cfo', 'buffett', 'dalio', 'dimon']),
  ('Career', array['hiring_manager', 'mentor', 'skeptic', 'dimon']),
  ('Building', array['jobs', 'da_vinci', 'skeptic', 'dreamer']),
  ('Life', array['mentor', 'dreamer', 'franklin', 'washington'])
) as p (name, advisors)
where u.id = core.dev_owner_id()
on conflict do nothing;

notify pgrst, 'reload schema';
