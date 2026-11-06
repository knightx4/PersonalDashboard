-- A session thread that only thinks (plan #2789.11, under feature #2789).
--
-- "Think it through" on Ask Dash sends the question to a session thread on
-- this app instead of answering it in the request. That session weighs the
-- options, cites its sources and ends with what it would do, and changes
-- nothing: no code, no commit, no plan row. The thread carries the mark so
-- the broker can give its session that prompt, and so the session's answer
-- sends a notification that opens the thread.
--
--   mode   work    a thread to talk about and change the code (the default,
--                  and every thread written before this)
--          think   a question to think through, with no change made
--
-- Schema only: the default fills every existing row with 'work', and no
-- account's rows are read or rewritten.

alter table core.session_threads
  add column if not exists mode text not null default 'work';

alter table core.session_threads
  drop constraint if exists session_threads_mode_ck;
alter table core.session_threads
  add constraint session_threads_mode_ck check (mode in ('work', 'think'));

comment on column core.session_threads.mode is
  'work: a thread on the code. think: a question from Ask Dash to think through, answered with no change made (plan #2789.11).';
