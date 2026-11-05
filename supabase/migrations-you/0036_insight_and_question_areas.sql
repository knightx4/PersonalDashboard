-- Which life area an insight or a question is about (plan #2629.1).
--
-- Each row of you.insights and you.dash_questions can name one of the person's
-- Goals areas. The column is nullable: every card and question written so far
-- has none until a run tags it, and one with no area stays valid.
--
-- The key is (area_id, user_id) against goals.areas (id, user_id), the pair the
-- goals tables use, because a foreign key bypasses row level security and a
-- plain reference to the id would accept another account's area. Deleting an
-- area clears only area_id (the column list on set null), so the row keeps
-- its owner. With area_id null the key is not checked.
--
-- Schema only: no rows are changed.

set search_path = you, public, extensions;

alter table you.insights
  add column area_id uuid,
  add constraint insights_area_fk
    foreign key (area_id, user_id) references goals.areas (id, user_id)
    on delete set null (area_id);

alter table you.dash_questions
  add column area_id uuid,
  add constraint dash_questions_area_fk
    foreign key (area_id, user_id) references goals.areas (id, user_id)
    on delete set null (area_id);

create index insights_user_area_idx on you.insights (user_id, area_id);
create index dash_questions_user_area_idx on you.dash_questions (user_id, area_id);
