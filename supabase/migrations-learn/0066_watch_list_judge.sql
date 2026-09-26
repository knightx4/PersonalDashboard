-- What the judge needs on learn.watch_list to work in two passes (plan #1066).
--
-- The first pass reads only a video's title, description and length. It
-- settles the clear skips and marks the rest as worth a transcript, which the
-- library run then fetches inside the month's credit allowance. The second
-- pass reads the transcript in windows (or, for a video over two hours or one
-- with no captions, its chapters) and settles the verdict.
--
--   screened_at   when the first pass read the video. Set for a skip and for
--                 one sent on to the second pass, so neither is read again.
--   judged_from   what the verdict was read from: 'title' (title, description
--                 and length), 'transcript', or 'chapters' (the chapter list
--                 or the whole video as one stretch, when there is no usable
--                 transcript).
--   stretches     the windows the verdict drew on, in order, each
--                 {"startSeconds", "endSeconds", "point"}: for a watch video
--                 the stretch worth watching, for a card video the parts worth
--                 a card (#1067 writes a card from each). Empty for a skip.

alter table learn.watch_list
  add column if not exists screened_at timestamptz,
  add column if not exists judged_from text,
  add column if not exists stretches jsonb not null default '[]'::jsonb;

alter table learn.watch_list drop constraint if exists watch_list_judged_from_ck;
alter table learn.watch_list add constraint watch_list_judged_from_ck
  check (judged_from is null or judged_from in ('title', 'transcript', 'chapters'));

alter table learn.watch_list drop constraint if exists watch_list_stretches_ck;
alter table learn.watch_list add constraint watch_list_stretches_ck
  check (jsonb_typeof(stretches) = 'array');

comment on column learn.watch_list.screened_at is
  'When the judge''s first pass (title, description, length) read the video (plan #1066).';
comment on column learn.watch_list.judged_from is
  'What the verdict was read from: title, transcript or chapters (plan #1066).';
comment on column learn.watch_list.stretches is
  'The windows the verdict drew on, [{startSeconds, endSeconds, point}]: the stretch to watch, or the parts worth a card.';
