-- A conversation with Dash that is about no one card or story (plan #1086).
--
-- Feature #1085 lets you ask Dash a question from anywhere in the app. Such a
-- question has no subject to hang from, so it gets a kind of its own:
--
--   ask          subject_ref is the conversation's own id, as text. Every
--                question starts a conversation of its own, and asking again
--                inside it adds to that one. The unique index on
--                (user_id, subject_kind, subject_ref) therefore still holds,
--                and appendTurns in lib/talk/store.ts finds it the same way.
--                A check constraint runs before ON CONFLICT is resolved, so
--                appendTurns sends the id along with the ref for this kind.
--                title is the question it began with.
--
-- The answer is worked out by calling read tools (plan #1088, #1089), and a
-- reply is only worth keeping with what it looked up and what it cited. Two
-- columns on the turn carry that, both empty for the Learn and News threads:
--
--   tool_calls   the lookups Dash made to write this turn, oldest first, as
--                an array of { name, input, result }.
--   citations    the rows this turn cites, as an array of
--                { table, ref, title, href }: only rows the tools returned.
--
-- Both are set on Dash's turns only; the check keeps them off the person's.

set search_path = core, public, extensions;

alter table core.conversations drop constraint conversations_kind_ck;
alter table core.conversations
  add constraint conversations_kind_ck check (subject_kind in ('feed_card', 'news_story', 'ask'));

-- An ask conversation names itself, so its ref cannot point anywhere else.
alter table core.conversations
  add constraint conversations_ask_ref_ck check (subject_kind <> 'ask' or subject_ref = id::text);

alter table core.conversation_turns
  add column tool_calls jsonb,
  add column citations jsonb;

alter table core.conversation_turns
  add constraint conversation_turns_tool_calls_ck check (
    tool_calls is null or (jsonb_typeof(tool_calls) = 'array' and role = 'assistant')
  ),
  add constraint conversation_turns_citations_ck check (
    citations is null or (jsonb_typeof(citations) = 'array' and role = 'assistant')
  );

-- Past questions, newest first, for the list that reopens them (plan #1090).
create index conversations_user_kind_created_idx
  on core.conversations (user_id, subject_kind, created_at desc);

comment on table core.conversations is
  'A saved conversation with Dash: about a Learn now card or a news story (plan #1053), or a question asked from anywhere (subject_kind ''ask'', plan #1086).';
comment on column core.conversation_turns.tool_calls is
  'On Dash''s turns in an ask conversation: the lookups made to write it, as [{ name, input, result }].';
comment on column core.conversation_turns.citations is
  'On Dash''s turns in an ask conversation: the rows it cites, as [{ table, ref, title, href }], only ones the tools returned.';
