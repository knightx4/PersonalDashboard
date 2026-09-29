-- The subject a kept channel sample was found for (plan #1197, under #1185).
--
-- Judging a channel found for a subject (#1196) judges three of its videos.
-- The ones judged watch or card are kept: each gets a learn.watch_list row
-- with came_from 'channel search', so it shows in the Videos section and
-- feeds the card run and the reading search like a video from the playlist.
-- The Videos section labels those rows with the subject they were found for,
-- which is what this column holds.
--
-- learn.watch_list.subject_id: the learn.subjects row the channel was found
-- for, set only on 'channel search' rows. Deleting the subject keeps the
-- video and forgets the label.

set search_path = learn, public, extensions;

alter table learn.watch_list
  add column if not exists subject_id uuid references learn.subjects (id) on delete set null;

alter table learn.watch_list drop constraint if exists watch_list_subject_came_from_ck;
alter table learn.watch_list add constraint watch_list_subject_came_from_ck
  check (subject_id is null or came_from = 'channel search');

create index if not exists watch_list_subject_id_idx
  on learn.watch_list (subject_id) where subject_id is not null;

comment on column learn.watch_list.subject_id is
  'The subject a channel-search video was found for; null on every other row (plan #1197).';
