-- The bot on People a Dev project belongs to (plan #3095).
--
-- A step Bob adds after MaeMae passed a request on is music studio work, but
-- add_plan_step had no way to know that, so #3064 and its steps landed under
-- the app as a whole and the plan routine, which cannot reach the music
-- repository, picked them up. With a bot tied to a project, a step that bot
-- adds or passes on is filed under that project when its detail names no
-- repository (lib/plan/step-project.ts).
--
-- dev_projects.bot_id: the bot (you.board_advisors) whose requests are the
-- project's work. Null for a project no bot speaks for. The key is the
-- composite one, so a project can only name a bot of the same account, and
-- removing the bot clears the tie and keeps the project.
--
-- Schema only: which bot belongs to which project is the account's own data,
-- set from the app or by a session scoped to the owner, never here.

set search_path = public, extensions;

alter table dev_projects add column if not exists bot_id uuid;

alter table dev_projects drop constraint if exists dev_projects_bot_fk;
alter table dev_projects add constraint dev_projects_bot_fk
  foreign key (bot_id, user_id) references you.board_advisors (id, user_id)
  on delete set null (bot_id);

comment on column dev_projects.bot_id is
  'The bot on People whose requests are this project''s work: a plan step it adds or passes on is filed here (plan #3095).';
