-- Each design critic round, kept with its pictures (plan #1533).
--
-- docs/UI-QUALITY-SPEC.md, Part 2. A step that changes a screen has its
-- gallery shots judged by the ui-critic agent, up to three rounds per surface,
-- and the builder never writes the verdict. Until now a round was kept as a
-- gitignored JSON file and one line in the commit body, which nothing could
-- query. This keeps one row per round, and the shots that round judged in a
-- private bucket, so the person can see later what the critic saw and plan
-- #1534 can refuse to close a step with a surface that never passed.
--
-- A round belongs to a plan step (`step`, the number shown on /dev/plan) or,
-- when the notes routine fixes a surface, to a note (`note_id`). Exactly one
-- of the two is set. Neither is a foreign key: the step number is what the
-- commit, the brief and the guard all speak, and a note may be closed and
-- cleared without its history going with it.
--
-- `round` has no upper bound here. The loop stops after three, and what
-- follows a third failed round is the open decision #1535; the table should
-- not answer it by refusing a fourth row.
--
-- `fixes` and `earlier` are the arrays the critic wrote, copied unchanged from its
-- verdict: fixes are {shot, where, problem, breaks, change}, earlier are
-- {where, done}. `shots` are the paths in the ui-shots bucket, empty when the
-- round was recorded where the shots could not be uploaded.
--
-- The bucket, ui-shots, is private. Its files sit at
--   <user id>/<step number or note id>/<surface>/r<round>/<shot>.png
-- and an account can read its own folder and nothing else. Only the service
-- role writes, from scripts/ui-check.ts; no signed-in session uploads or
-- deletes here. Skipped where there is no storage schema, which is the local
-- test database, as for the goals-documents bucket (goals 0011).

set search_path = public, extensions;

create table if not exists ui_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  step integer,
  note_id uuid,
  surface text not null,
  round integer not null,
  verdict text not null,
  fixes jsonb not null default '[]'::jsonb,
  earlier jsonb not null default '[]'::jsonb,
  notes text,
  shots text[] not null default '{}',
  commit_sha text,
  created_at timestamptz not null default now(),
  constraint ui_checks_one_owner_ck check (num_nonnulls(step, note_id) = 1),
  constraint ui_checks_step_ck check (step is null or step > 0),
  constraint ui_checks_surface_ck check (length(btrim(surface)) > 0 and length(surface) <= 80),
  constraint ui_checks_round_ck check (round >= 1),
  constraint ui_checks_verdict_ck check (verdict in ('pass', 'fix')),
  constraint ui_checks_fixes_ck check (jsonb_typeof(fixes) = 'array'),
  constraint ui_checks_earlier_ck check (jsonb_typeof(earlier) = 'array'),
  constraint ui_checks_notes_length_ck check (notes is null or length(notes) <= 8000),
  constraint ui_checks_shots_ck check (cardinality(shots) <= 8),
  constraint ui_checks_commit_sha_ck check (commit_sha is null or length(commit_sha) <= 40),
  -- One row per round. Recording a round again replaces it, so a round
  -- recorded before its shots could be uploaded can be completed later.
  constraint ui_checks_step_round_key unique (user_id, step, surface, round),
  constraint ui_checks_note_round_key unique (user_id, note_id, surface, round)
);

alter table ui_checks enable row level security;

create policy ui_checks_select on ui_checks for select to authenticated
  using (user_id = (select auth.uid()));
create policy ui_checks_insert on ui_checks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy ui_checks_update on ui_checks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy ui_checks_delete on ui_checks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud for the reasons 0050 gives: the grant makes this true on a
-- database rebuilt from the files, and the revoke undoes the default that
-- hands every new table to anon.
grant select, insert, update, delete on ui_checks to authenticated;
revoke all on table ui_checks from anon;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the ui-shots bucket. Expected on the local test database.';
    return;
  end if;

  -- 5 MB: a laptop shot of a long page runs to about one.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('ui-shots', 'ui-shots', false, 5242880, array['image/png'])
  on conflict (id) do nothing;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'ui_shots_select'
  ) then
    execute $p$
      create policy ui_shots_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'ui-shots'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $p$;
  end if;
end;
$$;
