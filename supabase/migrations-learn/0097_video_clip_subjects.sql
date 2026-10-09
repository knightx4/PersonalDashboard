-- Every subject a clip serves, one row per clip and subject (plan #1695, under #1694).
--
-- A subject page gets a Clips player that plays only the clips serving that
-- subject (#1697). Until now a clip carried one subject at most, in
-- video_clips.subject_id, set only when the cutter's single "serves" name
-- matched one of the person's tracks. The cutter now names every track and
-- goal a clip serves, and each track it names gets a row here.
--
-- learn.video_clip_subjects:
--   clip_id      the clip (learn.video_clips). Removed with the clip.
--   subject_id   a track it serves (learn.subjects). Removed with the track.
--   user_id      whose, the same person as the clip and the track.
--   created_at   when it was tagged.
--
-- video_clips.subject_id stays, as the first match, because the clip ranker's
-- theme lean reads it (lib/learn/clips/rank.ts). This table is what a
-- subject's player reads.
--
-- The existing one-subject clips are carried over here, so a subject that had
-- tagged clips keeps them. Clips tagged with nothing are left for the one-off
-- run in #1696.
--
-- A join row, not something the person wrote: listed as not a source in
-- lib/learn/sources.ts.

set search_path = learn, public, extensions;

create table if not exists learn.video_clip_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  clip_id uuid not null references learn.video_clips (id) on delete cascade,
  subject_id uuid not null,
  created_at timestamptz not null default now(),

  constraint video_clip_subjects_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id)
    on delete cascade,
  constraint video_clip_subjects_clip_subject_uq unique (clip_id, subject_id)
);

-- A subject's player reads its clip ids by person and subject.
create index if not exists video_clip_subjects_user_subject_idx
  on learn.video_clip_subjects (user_id, subject_id);

-- Deleting a track finds its rows through this.
create index if not exists video_clip_subjects_subject_idx
  on learn.video_clip_subjects (subject_id);

alter table learn.video_clip_subjects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'video_clip_subjects' and policyname = 'video_clip_subjects_all'
  ) then
    create policy video_clip_subjects_all on learn.video_clip_subjects for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.video_clip_subjects from anon, authenticated;
grant select, insert, update, delete on learn.video_clip_subjects to authenticated;
grant select, insert, update, delete on learn.video_clip_subjects to service_role;

comment on table learn.video_clip_subjects is
  'Each subject a clip serves, one row per clip and subject, read by a subject''s Clips player (plan #1695).';

-- Carry over the clips already tagged with one subject.
insert into learn.video_clip_subjects (user_id, clip_id, subject_id)
select c.user_id, c.id, c.subject_id
from learn.video_clips c
where c.subject_id is not null
on conflict (clip_id, subject_id) do nothing;
