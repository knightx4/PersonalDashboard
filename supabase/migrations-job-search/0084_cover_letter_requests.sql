-- A cover letter waiting for the routine to write it.
--
-- The Draft button on an application's cover letter no longer calls the API.
-- It writes a row here and fires the goals routine with the cover-letters
-- skill (.claude/skills/cover-letters/SKILL.md), which reads everything on
-- file through scripts/cover-letter.ts, writes the letter with the person's
-- cover letter skill, and saves it beside the editor in application_drafts
-- (kind cover_letter), as the API path did.
--
--   status  queued    written by the press, the routine fired
--           drafting  the routine's session has read the material
--           done      the letter is saved in application_drafts
--           failed    the routine gave up, or could not be started; error says why
--
-- One open request per application: pressing again while one waits returns
-- the waiting one. Bookkeeping, so lib/jobs/sources.ts lists it as not a
-- source.

set search_path = job_search, extensions;

create table if not exists cover_letter_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  status text not null default 'queued',
  error text,
  run_url text,
  requested_at timestamptz not null default now(),
  taken_at timestamptz,
  finished_at timestamptz,
  constraint cover_letter_requests_status_ck check (status in ('queued', 'drafting', 'done', 'failed'))
);

create index if not exists cover_letter_requests_user_idx on cover_letter_requests (user_id);
create index if not exists cover_letter_requests_application_idx
  on cover_letter_requests (application_id, requested_at desc);
create unique index if not exists cover_letter_requests_one_open
  on cover_letter_requests (application_id) where status in ('queued', 'drafting');

create trigger cover_letter_requests_same_owner before insert or update on cover_letter_requests
  for each row execute function job_search.assert_parents_same_owner();

alter table cover_letter_requests enable row level security;

create policy cover_letter_requests_select on cover_letter_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy cover_letter_requests_insert on cover_letter_requests for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy cover_letter_requests_update on cover_letter_requests for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on cover_letter_requests to authenticated;
grant all on cover_letter_requests to service_role;
revoke all on cover_letter_requests from anon;

notify pgrst, 'reload schema';
