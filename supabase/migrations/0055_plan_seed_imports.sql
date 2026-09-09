-- What the seed has already handed over.
--
-- 0051 seeded the plan once and left it there, which meant every step written
-- into `lib/plan/seed.ts` afterwards had to be retyped into a form to reach the
-- page. Importing whatever is missing on each visit fixes that, but on its own
-- it breaks something worse: a step you deleted on purpose would be handed back
-- on the next page load, permanently, with no way to refuse it.
--
-- So "is this step in the plan" and "has this step ever been offered" are
-- different questions, and this table answers the second. The sync brings in
-- only keys that have never been offered, and records them at the moment it
-- does. Delete a step afterwards and it stays deleted; the key is still here.
--
-- The key is the module and the title, joined -- the same key
-- `planStepKey` builds in lib/plan/seed.ts, and the same shape the seed's own
-- uniqueness test enforces. Module rather than title alone because every module
-- numbers its steps from 1 and "1. Fill the bank" is a real collision.
--
-- The unique constraint on (user_id, step_key) is what makes the sync safe to
-- run from a page render. Two requests arriving together both try to claim the
-- same keys; Postgres lets one win, the loser's insert is ignored, and only the
-- winner goes on to write the plan rows. Without it, a hover-prefetch and the
-- click behind it would duplicate every new step.
--
-- The surrogate `id` is not needed by any query here. It is there because
-- tests/rls.test.ts checks isolation by selecting one seeded row by id from
-- every table in the schema, and a table shaped so that check cannot run is a
-- table quietly exempt from it.

set search_path = public, extensions;

create table if not exists plan_seed_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- `module:title`, or `app:title` for a step belonging to no module.
  step_key text not null,
  imported_at timestamptz not null default now(),
  constraint plan_seed_imports_user_key_uq unique (user_id, step_key),
  constraint plan_seed_imports_key_not_blank_ck check (length(btrim(step_key)) > 0)
);

-- Everything already in a plan counts as offered, or the first sync after this
-- migration would hand back all fifty steps of the original import as
-- duplicates. Custom steps get a row too; harmless, since a title you invented
-- is not in the seed and will never be matched against.
insert into plan_seed_imports (user_id, step_key)
select distinct user_id, coalesce(module, 'app') || ':' || title
from plan_items
on conflict do nothing;

alter table plan_seed_imports enable row level security;

drop policy if exists plan_seed_imports_select on plan_seed_imports;
create policy plan_seed_imports_select on plan_seed_imports for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists plan_seed_imports_insert on plan_seed_imports;
create policy plan_seed_imports_insert on plan_seed_imports for insert to authenticated
  with check (user_id = (select auth.uid()));
-- Delete, so that a step refused by accident can be offered again by clearing
-- its key. There is no update: a key is the row.
drop policy if exists plan_seed_imports_delete on plan_seed_imports;
create policy plan_seed_imports_delete on plan_seed_imports for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on plan_seed_imports to authenticated;

revoke all on table plan_seed_imports from anon;
