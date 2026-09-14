-- When you last opened each conversation.
--
-- /dev/raised lists every thread on the account, and the point of the list is
-- telling apart the answers you have read from the ones that arrived while you
-- were away. #432 settled how: a conversation is marked read when you open it,
-- so what stays marked is exactly what you have not looked at. That needs one
-- date per conversation, which is this table.
--
-- The alternatives it rules out are both cheaper and both wrong. One date on
-- the account is cleared every time you open the page for something else, and
-- it does it silently. Nothing stored at all leaves a thread Dash spoke last
-- in marked for good, including every one you have read and finished with.
--
-- `dev_comments` names its target with four nullable foreign keys, so a
-- deleted row takes its thread with it. This table uses a target name and a
-- plain uuid instead, because the key it needs is (account, target, row) and
-- an upsert has to be able to name it: four partial unique indexes cannot be
-- inferred as the arbiter of an `on conflict`. What that gives up is the
-- cascade, so a deleted row leaves a read mark behind. The mark is a date
-- pointing at nothing and it is only ever read by joining against a
-- conversation that exists, so it costs a row and changes nothing.

set search_path = public, extensions;

create table if not exists dev_comment_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which kind of row the thread hangs off. Mirrors COMMENT_TARGETS in
  -- lib/comments/load.ts.
  target text not null,
  -- The row itself: an idea, a plan step, a raise or a bug note. Not a foreign
  -- key, because it is one of four tables -- see above.
  row_id uuid not null,
  -- When you last opened it. Compared against the newest message in the
  -- thread, and nothing else.
  read_at timestamptz not null default now(),
  primary key (user_id, target, row_id),
  constraint dev_comment_reads_target_ck
    check (target in ('idea', 'step', 'raise', 'note'))
);

alter table dev_comment_reads enable row level security;

-- Yours to read and yours to write: opening a conversation is a write you make
-- yourself, unlike the digest next door, which only the cron writes.
drop policy if exists dev_comment_reads_select on dev_comment_reads;
create policy dev_comment_reads_select on dev_comment_reads for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists dev_comment_reads_insert on dev_comment_reads;
create policy dev_comment_reads_insert on dev_comment_reads for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists dev_comment_reads_update on dev_comment_reads;
create policy dev_comment_reads_update on dev_comment_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out: the grant is what makes this migration true on a
-- database rebuilt from the migrations alone, and the revoke is because those
-- same defaults hand every new table to `anon`.
grant select, insert, update on dev_comment_reads to authenticated;

revoke all on table dev_comment_reads from anon;
