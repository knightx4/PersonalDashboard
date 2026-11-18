-- What a bot's message sounds like when it is read aloud (plan #3079).
--
-- Chat voice used to read a bubble nearly word for word, step outlines,
-- counts and dates included. A bubble is now rewritten once, by Haiku, into
-- a short version a person would say out loud (lib/talk/speech/script.ts),
-- and that is what Fish Audio is sent. The rewrite is kept here, on the
-- bubble, so a second hearing sends the same words without another call.
-- The bubble's `text` is never changed.
--
-- Null, the usual case, is a bubble not yet heard, or one whose rewrite
-- failed: the next hearing tries again, and until then the cleaned bubble
-- text is spoken. The rewrite is held to 600 characters by the code, the
-- most of one reply that is spoken; the check allows some room.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

alter table you.advisor_messages
  add column if not exists spoken_text text;

alter table you.advisor_messages
  drop constraint if exists advisor_messages_spoken_text_ck;

alter table you.advisor_messages
  add constraint advisor_messages_spoken_text_ck check (spoken_text is null or char_length(spoken_text) <= 1000);

comment on column you.advisor_messages.spoken_text is
  'The short spoken version of this message that chat voice reads aloud instead of the text, written once by Haiku (lib/talk/speech/script.ts); null until first heard or when the rewrite failed (plan #3079).';
