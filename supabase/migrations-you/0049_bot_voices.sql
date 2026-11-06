-- A voice of its own for each bot (plan #3006.5, under #3006).
--
-- Chat replies are read aloud by Fish Audio (#3006.3). Until now every bot
-- spoke in the one voice set in the deployment's FISH_AUDIO_VOICE_ID. On a
-- bot's form the person can now choose a Fish voice for it, and its replies
-- are read in that voice every time.
--
-- you.board_advisors gains
--
--   voice_id     the Fish voice model's id (its reference_id), from the
--                picker or pasted from fish.audio; null speaks in the
--                default voice
--   voice_name   the voice's name as Fish gave it, for the form to show
--                without asking Fish; null when the id was pasted and Fish
--                could not be asked
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

alter table you.board_advisors
  add column voice_id text
    constraint board_advisors_voice_id_ck
      check (voice_id is null or voice_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  add column voice_name text
    constraint board_advisors_voice_name_ck
      check (voice_name is null or char_length(btrim(voice_name)) between 1 and 120),
  add constraint board_advisors_voice_name_needs_id_ck
    check (voice_name is null or voice_id is not null);

comment on column you.board_advisors.voice_id is
  'The Fish Audio voice this bot''s replies are read aloud in (the reference_id sent with each reply); null reads them in the default voice (plan #3006.5).';
comment on column you.board_advisors.voice_name is
  'The name of the voice in voice_id, as Fish Audio lists it, for the bot''s form; null when it is not known (plan #3006.5).';

notify pgrst, 'reload schema';
