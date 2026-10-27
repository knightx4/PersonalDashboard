-- What a decided board question made happen (plan #2561.9).
--
-- After deciding, Make it happen writes the decision's action and the
-- verdict's conditions as todos (todo.tasks) or as steps under a goal
-- (goals.items). made is the list of rows it wrote, [ { kind, id, role } ]:
-- kind is todo or step, id the row's id, role action or condition. The titles
-- and dates are read back from the rows themselves, so a todo the person
-- renamed or a step Undo took away shows as it now is. A column of ids across
-- schemas is not a foreign key, so a row that is gone is left out when read.
--
-- Nothing is rewritten: existing questions start with an empty list.

alter table you.board_questions
  add column made jsonb not null default '[]'::jsonb;

alter table you.board_questions
  add constraint board_questions_made_ck check (jsonb_typeof(made) = 'array');

comment on column you.board_questions.made is
  'The todos and goal steps Make it happen wrote from the decision, [ { kind, id, role } ], read back by id (plan #2561.9).';
