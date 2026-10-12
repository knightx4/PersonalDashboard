-- What you hid from an essay's study panel (plan #1863.8,
-- LEARN-ESSAYS-SPEC "From your study": "You can hide an item for this
-- essay").
--
-- Each entry is the item's key as lib/learn/essays/study.ts writes it, such
-- as `passage:<note id>:<heading path>` or `reading:<id>`. Hiding is for this
-- essay only, so the list lives on the essay.

alter table learn.essays
  add column if not exists study_hidden text[] not null default '{}';

comment on column learn.essays.study_hidden is
  'Keys of the study panel items hidden for this essay (plan #1863.8).';
