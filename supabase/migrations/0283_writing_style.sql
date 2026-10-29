-- How the person writes, read from the email they sent, for the Writing style
-- page on Dash (/ask/writing-style).
--
-- One row per account: the analysis as markdown, what it was read from, and
-- when. A session writes it with the service role after reading the sent
-- mail; the person reads their own row and writes none. Nothing else reads it
-- yet, so it is catalogued as not a source.

set search_path = core, public, extensions;

create table if not exists core.writing_style (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The analysis, in markdown.
  body text not null,
  -- What was read, in a line: "Sent mail before 1 January 2025".
  read_from text not null,
  -- How many of their own messages the analysis rests on.
  messages_read integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint writing_style_body_ck check (btrim(body) <> '' and length(body) <= 60000),
  constraint writing_style_read_from_ck check (length(btrim(read_from)) between 1 and 200),
  constraint writing_style_messages_read_ck check (messages_read >= 0)
);

drop trigger if exists writing_style_touch_updated_at on core.writing_style;
create trigger writing_style_touch_updated_at
  before update on core.writing_style
  for each row execute function public.touch_updated_at();

alter table core.writing_style enable row level security;

drop policy if exists writing_style_select on core.writing_style;
create policy writing_style_select on core.writing_style for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.writing_style from public, anon, authenticated;
grant select on core.writing_style to authenticated;
grant select, insert, update, delete on core.writing_style to service_role;

comment on table core.writing_style is
  'How the person writes, read from their sent email, shown on the Writing style page of Dash. Not read by anything else yet.';
