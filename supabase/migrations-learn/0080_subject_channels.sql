-- The YouTube channels Learn found for a subject, what it made of each, and
-- what became of it (plan #1194, under #1185).
--
-- For a subject being studied, one Sonnet call with web search names up to
-- five channels people recommend for it (#1195). Three of each channel's
-- videos on the subject are judged through their transcripts (#1196), and the
-- channel is marked follow or pass with a reason that refers to the person's
-- level. A channel marked follow is added to the YouTube library by Learn
-- itself, with an Unfollow beside it (#1198, decision #1200: B). The subject's
-- page shows all of it (#1199).
--
-- learn.subject_channels, one row per subject and channel:
--   youtube_channel_id  the channel's id (UC...), resolved from the handle or
--                       by search when the recommendation named none.
--   title, handle       the channel's name, and its @handle when it has one.
--   found_why           what the recommendation said about the channel.
--   verdict, why        'follow' or 'pass', and the reason. Null until the
--                       samples are judged.
--   samples             the videos judged for it, as
--                       [{"video_id", "title", "verdict", "line"}], verdict
--                       being the video judge's watch, card or skip. Empty
--                       until they are picked.
--   judged_at           when the verdict was written.
--   decided             what became of it: 'followed' when it went into the
--                       library, 'unfollowed' when the person took it out
--                       again, 'passed' when it was passed over. A passed or
--                       unfollowed channel is not suggested for the subject
--                       again, because the row stays.
--   decided_at          when decided was last set.
--
-- The row goes with the subject. A sample judged worth watching or worth a
-- card also becomes a learn.watch_list row with came_from 'channel search'
-- (#1197), which the widened check below allows.

set search_path = learn, public, extensions;

create table if not exists learn.subject_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  youtube_channel_id text not null,
  title text not null,
  handle text,
  found_why text,

  verdict text,
  why text,
  samples jsonb not null default '[]'::jsonb,
  judged_at timestamptz,

  decided text,
  decided_at timestamptz,

  created_at timestamptz not null default now(),

  constraint subject_channels_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint subject_channels_subject_channel_uq unique (subject_id, youtube_channel_id),
  constraint subject_channels_channel_id_ck check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  constraint subject_channels_title_ck check (btrim(title) <> ''),
  constraint subject_channels_handle_ck check (handle is null or handle ~ '^@[^[:space:]/]{1,100}$'),
  constraint subject_channels_verdict_ck check (
    (verdict is null and why is null and judged_at is null)
    or (verdict in ('follow', 'pass') and why is not null and btrim(why) <> '' and judged_at is not null)
  ),
  constraint subject_channels_samples_ck check (
    jsonb_typeof(samples) = 'array' and jsonb_array_length(samples) <= 3
  ),
  constraint subject_channels_decided_ck check (
    (decided is null and decided_at is null)
    or (decided in ('followed', 'unfollowed', 'passed') and decided_at is not null)
  )
);

create index if not exists subject_channels_channel_idx on learn.subject_channels (user_id, youtube_channel_id);

alter table learn.subject_channels enable row level security;

drop policy if exists subject_channels_all on learn.subject_channels;
create policy subject_channels_all on learn.subject_channels for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.subject_channels from anon;
grant select, insert, update, delete on learn.subject_channels to authenticated;
grant select, insert, update, delete on learn.subject_channels to service_role;

comment on table learn.subject_channels is
  'YouTube channels Learn found for a subject, with the follow or pass verdict from three sampled '
  'videos and what became of each channel (plan #1185).';

-- A video kept from a found channel's samples (#1197).
alter table learn.watch_list drop constraint if exists watch_list_came_from_ck;
alter table learn.watch_list add constraint watch_list_came_from_ck
  check (came_from in ('playlist', 'takeout', 'channel search'));
