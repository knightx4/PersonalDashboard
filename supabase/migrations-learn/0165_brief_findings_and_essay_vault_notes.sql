-- What another chat adds to a brief, and vault notes attached to an essay.
--
--   learn.brief_findings     a finding added to a research brief after its run,
--                            from the Dash connector or Ask (add_to_brief):
--                            the finding in a few sentences, the sub-question
--                            it answers (null for one that fits none), and the
--                            sources it rests on, each a title, an https link
--                            and the words quoted from it. The run never
--                            writes here, so running it again keeps them.
--   learn.essay_vault_notes  a vault note attached to an essay's notes
--                            (attach_vault_note). The Notes tab lists them and
--                            Update the map reads their text with the notes.
--
-- One row each, so the one undo rule in lib/core/dash-actions.ts takes an
-- added one away by deleting it.

set search_path = learn, public, extensions;

create table if not exists learn.brief_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  brief_id uuid not null,
  sub_question_id text,
  body text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brief_findings_brief_fk
    foreign key (brief_id, user_id) references learn.briefs (id, user_id)
    on delete cascade,
  constraint brief_findings_body_ck check (btrim(body) <> '' and length(body) <= 4000),
  constraint brief_findings_sources_array check (jsonb_typeof(sources) = 'array')
);

create index if not exists brief_findings_brief_idx
  on learn.brief_findings (brief_id, created_at);

create index if not exists brief_findings_user_idx
  on learn.brief_findings (user_id);

create table if not exists learn.essay_vault_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  note_id uuid not null,
  why text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essay_vault_notes_essay_fk
    foreign key (essay_id, user_id) references learn.essays (id, user_id)
    on delete cascade,
  constraint essay_vault_notes_note_fk
    foreign key (note_id, user_id) references obsidian.notes (id, user_id)
    on delete cascade,
  constraint essay_vault_notes_why_ck check (length(why) <= 500),
  constraint essay_vault_notes_uq unique (essay_id, note_id)
);

create index if not exists essay_vault_notes_user_idx
  on learn.essay_vault_notes (user_id);

create index if not exists essay_vault_notes_note_idx
  on learn.essay_vault_notes (note_id);

alter table learn.brief_findings enable row level security;
alter table learn.essay_vault_notes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'brief_findings' and policyname = 'brief_findings_all'
  ) then
    create policy brief_findings_all on learn.brief_findings for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'essay_vault_notes' and policyname = 'essay_vault_notes_all'
  ) then
    create policy essay_vault_notes_all on learn.essay_vault_notes for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.brief_findings from anon, authenticated;
revoke all on learn.essay_vault_notes from anon, authenticated;
grant select, insert, update, delete on learn.brief_findings to authenticated, service_role;
grant select, insert, update, delete on learn.essay_vault_notes to authenticated, service_role;

comment on table learn.brief_findings is
  'Findings added to a research brief after its run (add_to_brief), each with its sources. The run never writes here.';
comment on table learn.essay_vault_notes is
  'Vault notes attached to an essay''s notes (attach_vault_note). Update the map reads their text with the notes.';

notify pgrst, 'reload schema';
