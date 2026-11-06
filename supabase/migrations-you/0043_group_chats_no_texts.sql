-- Groups never text first (plan #2879.1.4, under #2879.1).
--
-- In a group chat nothing happens without the person: the bots answer what
-- they write and never send a message unasked, and the daily texts round
-- (.claude/skills/board/council.md) writes only into a bot's direct chat.
-- The round already finds a mentor's thread by advisor_id, which a group
-- does not have; this trigger holds the rule in the database as well, so a
-- text_first or an ack written into a group is refused whoever writes it.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

create or replace function you.advisor_messages_group_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind <> 'reply' and exists (
    select 1 from you.advisor_chats c where c.id = new.chat_id and c.kind = 'group'
  ) then
    raise exception 'A group chat holds replies only; bots never text a group first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger advisor_messages_group_kind
  before insert or update of kind, chat_id on you.advisor_messages
  for each row execute function you.advisor_messages_group_kind();

revoke all on function you.advisor_messages_group_kind() from public, anon, authenticated;
