-- ===========================================================================
-- What each kind of document taught a form (plan #987).
--
-- The first time a goal is given a kind of document (an NSLDS export, a
-- servicer statement, a pay stub), the reader works out which label fills
-- which field and which labels are traps, and the person adds the fields the
-- form lacked or corrects what the reader got wrong. This table keeps that,
-- one row per kind of document and collection, so the next document of the
-- same kind is read with it and fills in without asking again.
--
--   document_kinds.name         what the kind is called, as the reader named
--                               it or the person renamed it ("NSLDS export").
--                               Unique per collection among live rows.
--   document_kinds.recognise    how to tell a document is of this kind: its
--                               title or header, who issues it, its layout.
--                               The reader judges a new document against it.
--   document_kinds.field_notes  {"<field key>": "<note>"}: for each field,
--                               which label in the document fills it and any
--                               trap to avoid. Added to the reader's
--                               instructions for a document of this kind.
--   document_kinds.skipped      labels the reader suggested as new fields and
--                               the person left out, so a document of this
--                               kind does not suggest them again.
--   document_kinds.last_read_at when a document of this kind was last saved
--                               into the form.
--
-- The app writes a row when a read is saved (lib/goals/document-kinds.ts),
-- and the person edits it on the step. Forgetting a kind archives it.
-- ===========================================================================

-- A field note map: an object of field keys to notes of up to 1000 characters.
create or replace function goals.document_kind_notes_ok(notes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(notes) = 'object'
     and (select count(*) from jsonb_object_keys(notes)) <= 60
     and not exists (
       select 1 from jsonb_each(notes) e
       where e.key !~ '^[a-z][a-z0-9_]{0,39}$'
          or jsonb_typeof(e.value) <> 'string'
          or length(e.value #>> '{}') > 1000
     );
$$;

-- The labels left out: a list of up to 60 strings of up to 200 characters.
create or replace function goals.document_kind_skipped_ok(skipped jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(skipped) = 'array'
     and jsonb_array_length(skipped) <= 60
     and not exists (
       select 1 from jsonb_array_elements(skipped) s
       where jsonb_typeof(s.value) <> 'string'
          or btrim(s.value #>> '{}') = ''
          or length(s.value #>> '{}') > 200
     );
$$;

-- The checks run as whoever writes the row.
revoke all on function goals.document_kind_notes_ok(jsonb) from public, anon;
revoke all on function goals.document_kind_skipped_ok(jsonb) from public, anon;
grant execute on function goals.document_kind_notes_ok(jsonb) to authenticated, service_role;
grant execute on function goals.document_kind_skipped_ok(jsonb) to authenticated, service_role;

create table goals.document_kinds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  collection_id uuid not null,
  name text not null,
  recognise text not null default '',
  field_notes jsonb not null default '{}'::jsonb,
  skipped jsonb not null default '[]'::jsonb,

  last_read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint document_kinds_id_user_key unique (id, user_id),
  constraint document_kinds_collection_fk foreign key (collection_id, user_id)
    references goals.collections (id, user_id) on delete cascade,

  constraint document_kinds_name_ck check (btrim(name) <> '' and length(name) <= 120),
  constraint document_kinds_recognise_ck check (length(recognise) <= 1000),
  constraint document_kinds_notes_ck check (goals.document_kind_notes_ok(field_notes)),
  constraint document_kinds_skipped_ck check (goals.document_kind_skipped_ok(skipped))
);

create unique index document_kinds_name_key on goals.document_kinds (collection_id, lower(btrim(name)))
  where archived_at is null;

create trigger document_kinds_touch_updated_at before update on goals.document_kinds
  for each row execute function goals.touch_updated_at();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context', 'answers', 'briefs', 'document_kinds'
  )
);

create trigger document_kinds_history after insert or update or delete on goals.document_kinds
  for each row execute function goals.record_history();

alter table goals.document_kinds enable row level security;

create policy document_kinds_all on goals.document_kinds for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.document_kinds from anon, public;
grant select, insert, update, delete on goals.document_kinds to authenticated, service_role;

comment on table goals.document_kinds is
  'What each kind of document taught a collection''s form: how to recognise it, which label fills each field and the traps to avoid, and the suggested fields the person left out. Read into the reader''s instructions for the next document of the same kind.';

notify pgrst, 'reload schema';
