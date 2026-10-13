-- Essays and their margin notes (plan #1864, under #1863; docs/LEARN-ESSAYS-SPEC.md, "Schema").
--
-- An essay is a vault note with type: essay. The note is the essay; these
-- tables hold what the vault cannot: the unsaved draft, the brief, who wrote
-- which words, Dash's margin notes and the published snapshot.
--
-- learn.essays, one row per essay:
--   note_id        the vault note (obsidian.notes), null once the note is deleted.
--   path           the note's path in the vault when last read or written.
--   blob_sha       the note's blob sha at that time, to see an edit made elsewhere.
--   draft_body     the body as last typed, which may be ahead of the vault.
--   unsaved        true while draft_body has not been written to the vault.
--   brief          { question, claim, reader, pinned: [...] } in the person's words.
--   word_target    the length they aimed at, 200 to 2000.
--   authorship     the ranges as [{ "author", "start", "length" }], graphemes from
--                  the start of the file; the authorship block is built from it.
--   published_body the snapshot last published, with the authorship block removed.
--   published_at   when it was last published.
--   slug           the essay's fixed web address, unique per person.
-- A source of what they wrote.
--
-- learn.essay_notes, one row per margin note:
--   essay_id       the essay. Removed with it.
--   check_name     the check that raised it, such as 'the_claim'.
--   rung           how far up the ladder it is: 0 marker to 4 suggested sentence.
--   body           what Dash said.
--   anchor_quote / anchor_prefix / anchor_suffix / anchor_offset
--                  the text it is about, about 32 characters either side, and the
--                  offset as a hint for finding it again.
--   status         open, done, dismissed or detached.
-- Dash wrote these, so not a source.

set search_path = learn, public, extensions;

create table if not exists learn.essays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid,
  path text not null,
  blob_sha text,
  draft_body text not null default '',
  unsaved boolean not null default false,
  brief jsonb not null default '{}'::jsonb,
  word_target integer,
  authorship jsonb not null default '[]'::jsonb,
  published_body text,
  published_at timestamptz,
  slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essays_id_user_uq unique (id, user_id),
  constraint essays_note_fk
    foreign key (note_id, user_id) references obsidian.notes (id, user_id)
    on delete set null (note_id),
  constraint essays_word_target_range check (word_target is null or word_target between 200 and 2000),
  constraint essays_brief_object check (jsonb_typeof(brief) = 'object'),
  constraint essays_authorship_array check (jsonb_typeof(authorship) = 'array')
);

create unique index if not exists essays_user_note_uq
  on learn.essays (user_id, note_id) where note_id is not null;

create unique index if not exists essays_user_slug_uq
  on learn.essays (user_id, slug) where slug is not null;

create index if not exists essays_user_updated_idx
  on learn.essays (user_id, updated_at desc);

create table if not exists learn.essay_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  check_name text not null,
  rung integer not null default 0,
  body text not null default '',
  anchor_quote text not null default '',
  anchor_prefix text not null default '',
  anchor_suffix text not null default '',
  anchor_offset integer,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essay_notes_essay_fk
    foreign key (essay_id, user_id) references learn.essays (id, user_id)
    on delete cascade,
  constraint essay_notes_rung_range check (rung between 0 and 4),
  constraint essay_notes_status_check check (status in ('open', 'done', 'dismissed', 'detached'))
);

create index if not exists essay_notes_essay_idx
  on learn.essay_notes (essay_id, status);

create index if not exists essay_notes_user_idx
  on learn.essay_notes (user_id);

alter table learn.essays enable row level security;
alter table learn.essay_notes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'essays' and policyname = 'essays_all'
  ) then
    create policy essays_all on learn.essays for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'essay_notes' and policyname = 'essay_notes_all'
  ) then
    create policy essay_notes_all on learn.essay_notes for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.essays from anon, authenticated;
revoke all on learn.essay_notes from anon, authenticated;
grant select, insert, update, delete on learn.essays to authenticated, service_role;
grant select, insert, update, delete on learn.essay_notes to authenticated, service_role;

comment on table learn.essays is
  'One row per essay: the vault note it is, the unsaved draft, brief, authorship ranges and published snapshot (plan #1864).';
comment on table learn.essay_notes is
  'Dash''s margin notes on an essay, anchored to quoted text (plan #1864).';
