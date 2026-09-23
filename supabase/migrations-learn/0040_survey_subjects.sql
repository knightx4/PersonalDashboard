-- Hidden tracks that hold survey questions about vault themes you have no
-- track for.
--
-- Plan #837 asks Practice Flow to test you now and then on something you write
-- about but never made a track for, so the Know grid can say how much you know
-- across fields and not only inside your tracks. Decision #838 settled where
-- those questions live: each surveyed theme gets a learn subject of its own,
-- marked as a survey, with one idea per question. The concepts, probes and
-- answers are the ordinary rows, so everything that writes and grades a
-- question works on it unchanged. What changes is that every list of your
-- tracks, the track picker in Practice Flow and the track weighting leave a
-- survey subject out.
--
-- Two columns:
--
--   survey     true for a hidden subject. Starting a real track with the same
--              name takes the subject over by setting this false, so the ideas
--              already tested there become the start of the track.
--   theme_id   the vault theme the subject was made for. Kept after a take
--              over, and at most one subject per theme, so "the subject for
--              theme X" has one answer. When the theme is deleted or merged
--              away the link is cleared and the subject, with its answers,
--              stays; it stays hidden too, because the flag is its own column.

set search_path = learn, public, extensions;

alter table learn.subjects
  add column if not exists survey boolean not null default false,
  add column if not exists theme_id uuid;

alter table learn.subjects drop constraint if exists subjects_theme_fk;
alter table learn.subjects
  add constraint subjects_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id)
    on delete set null (theme_id);

create unique index if not exists subjects_user_theme_uq
  on learn.subjects (user_id, theme_id)
  where theme_id is not null;

-- The survey subjects one account has, which is what each track list leaves
-- out and what the survey reads back.
create index if not exists subjects_user_survey_idx
  on learn.subjects (user_id)
  where survey;
