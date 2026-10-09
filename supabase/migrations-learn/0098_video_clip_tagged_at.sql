-- When a clip was last checked against the person's subjects (plan #1696, under #1694).
--
-- The clips cut before #1695 carry one subject at most. A one-off pass reads
-- each clip's caption and idea with the person's subject names and tags it in
-- learn.video_clip_subjects with every subject it fits. A clip that fits none
-- gets no row there, so this column is what tells the pass it has been read
-- and a second run leaves it alone.
--
-- learn.video_clips.tagged_at:
--   null   not yet checked against the subjects.
--   set    checked: by the pass, or at the cut, since the cutter (#1695)
--          tags each new clip with every subject it serves.
--
-- Nothing is backfilled here. Every clip starts unchecked, including the 49
-- carried over in 0097, so the pass can add the subjects they missed.

set search_path = learn, public, extensions;

alter table learn.video_clips add column if not exists tagged_at timestamptz;

comment on column learn.video_clips.tagged_at is
  'When the clip was checked against the person''s subjects; null until then (plan #1696).';

-- The pass reads the unchecked clips by person.
create index if not exists video_clips_untagged_idx
  on learn.video_clips (user_id, cut_at)
  where tagged_at is null;
