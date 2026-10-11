-- One row per time a note was read for concepts (plan #1721, under #1717).
--
-- Reading a note proposes concepts, a second check keeps, marks weak or drops
-- each, and the person approves what is left or walks away. Until now nothing
-- was kept of the proposals that were not approved, so there was no way to say
-- how many concepts a note yields or what share is taken. This table keeps the
-- counts at the moment of the reading, and the approval when it comes:
--
-- learn.note_reads
--   reading_id      the reading whose note was read. Set null if it is deleted.
--   subject_id      the subject the concepts were offered to. Set null likewise.
--   proposed        new concepts the extraction returned.
--   kept, weak      what the second check let through, by verdict.
--   dropped         what it took out, for any reason.
--   approved_at     when the person added the concepts to the graph; null while
--                   they have not, which is also what turning them down looks like.
--   approved_count  how many new concepts that added.
--
-- Rows start with this migration. Earlier readings recorded nothing and are not
-- backfilled. Bookkeeping, not something the person wrote: listed as not a
-- source in lib/learn/sources.ts.

set search_path = learn, public, extensions;

create table if not exists learn.note_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reading_id uuid references learn.readings (id) on delete set null,
  subject_id uuid references learn.subjects (id) on delete set null,
  proposed integer not null check (proposed >= 0),
  kept integer not null check (kept >= 0),
  weak integer not null check (weak >= 0),
  dropped integer not null check (dropped >= 0),
  approved_at timestamptz,
  approved_count integer check (approved_count is null or approved_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists note_reads_user_created_idx
  on learn.note_reads (user_id, created_at desc);

alter table learn.note_reads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'note_reads' and policyname = 'note_reads_all'
  ) then
    create policy note_reads_all on learn.note_reads for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.note_reads from anon, authenticated;
grant select, insert, update, delete on learn.note_reads to authenticated;
grant select, insert, update, delete on learn.note_reads to service_role;

comment on table learn.note_reads is
  'One row per reading of a note for concepts, with the counts and whether they were approved (plan #1721).';
