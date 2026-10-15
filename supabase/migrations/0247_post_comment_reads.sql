-- Comments on an X post draft (plan #2202.2, feature #2202).
--
-- A draft on the Posts tab gets a thread, kept in core.conversations under
-- the ref public.social_posts:<id> like every other row thread since 0167, so
-- no comment table changes. The conversations list folds it in with the dev
-- rows' threads, and opening it there marks it read in dev_comment_reads,
-- whose target gains 'post'.

alter table public.dev_comment_reads drop constraint if exists dev_comment_reads_target_ck;
alter table public.dev_comment_reads add constraint dev_comment_reads_target_ck
  check (target in ('idea', 'step', 'raise', 'note', 'spec', 'takeaway', 'change', 'post'));
