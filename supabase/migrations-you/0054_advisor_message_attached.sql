-- Saved pages and files a bot sent with its text on People (plan #3050.4,
-- under #3050).
--
-- A bot can now attach something the app already holds by reference: a page
-- or piece of writing in core.files, or a file in core.attachments. The
-- attach_saved lookup reads the row as the person and returns a card for it
-- (lib/talk/attached.ts, SavedAttachment): the table and id, the title, what
-- it is and where it opens. The card is kept on the bubble it goes with, the
-- last of the reply, as charts are (you 0052). The thread reads every card
-- back through parseSavedAttachment, so one that no longer parses draws
-- nothing. The card stays out of `text`, so the search index and voice
-- playback read the words alone.
--
-- Empty, the usual case, is a bubble with nothing attached. At most three
-- cards a bubble.
--
-- Schema change only. No row of any account is written: the column's
-- default fills every existing row with an empty array.

set search_path = you, public, extensions;

alter table you.advisor_messages
  add column if not exists attached jsonb not null default '[]'::jsonb;

alter table you.advisor_messages
  drop constraint if exists advisor_messages_attached_ck;

alter table you.advisor_messages
  add constraint advisor_messages_attached_ck check (jsonb_typeof(attached) = 'array' and jsonb_array_length(attached) <= 3);

comment on column you.advisor_messages.attached is
  'The saved pages and files a bot attached to this message by reference, as lib/talk/attached.ts parseSavedAttachment reads them; empty for most (plan #3050.4).';
