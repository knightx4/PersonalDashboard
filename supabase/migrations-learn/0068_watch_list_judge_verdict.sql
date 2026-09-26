-- What the judge said about a video, kept apart from the verdict it is filed
-- under now (plan #1068).
--
-- On the Videos page you can move a video to another pile when the judge got
-- it wrong. The move sets verdict and sets verdict_by to 'you', and the judge
-- never writes to such a row again. judge_verdict keeps the judge's own
-- answer, so the page can say "you moved this from skip" and the next judging
-- run can read your moves as examples: what it said, and what you said
-- instead.
--
-- The judge writes it with every verdict. It is null for a video you filed
-- before the judge read it.

alter table learn.watch_list
  add column if not exists judge_verdict text;

alter table learn.watch_list drop constraint if exists watch_list_judge_verdict_ck;
alter table learn.watch_list add constraint watch_list_judge_verdict_ck
  check (judge_verdict is null or judge_verdict in ('watch', 'card', 'skip'));

-- Every verdict the judge wrote so far is the judge's own.
update learn.watch_list
set judge_verdict = verdict
where verdict_by = 'judge' and judge_verdict is null;

comment on column learn.watch_list.judge_verdict is
  'The verdict the judge gave, kept when you move the video to another pile (plan #1068).';
