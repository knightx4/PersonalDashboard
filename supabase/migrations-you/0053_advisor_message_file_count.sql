-- How many files a bot's code made for this message (plan #3050.3.1, under
-- #3050.3).
--
-- A bot on People can now run code, and a picture or a PDF its code wrote is
-- kept in core.attachments under `you.advisor_messages:<id>`, the store the
-- person's own files use (core 0193). The files are not kept here. This
-- column only counts them, so an open thread hears the count change over
-- Realtime once the files are recorded and asks for them, since a Realtime
-- row never carries what core.attachments holds.
--
-- Zero, the usual case, is a message with no files of the bot's. The person's
-- own files are not counted: the send returns them with the message.
--
-- Schema change only. No row of any account is written: the default fills
-- every existing row with zero.

set search_path = you, public, extensions;

alter table you.advisor_messages
  add column if not exists file_count smallint not null default 0;

alter table you.advisor_messages
  drop constraint if exists advisor_messages_file_count_ck;

alter table you.advisor_messages
  add constraint advisor_messages_file_count_ck check (file_count between 0 and 5);

comment on column you.advisor_messages.file_count is
  'How many files a bot''s code made for this message, kept in core.attachments under you.advisor_messages:<id>; zero for most (plan #3050.3.1).';
