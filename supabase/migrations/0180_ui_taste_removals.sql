-- The preferences the person has taken off /dev/ui (plan #1547).
--
-- docs/UI-QUALITY-SPEC.md, Part 3. The preferences are written in
-- app/dev/ui/taste.ts, where the notes routine adds them and the design
-- critic reads them. The person can remove any of them from /dev/ui, and a
-- press on a page cannot edit a file in the repository, so the removal is
-- kept here: one row per preference taken off, by its id in taste.ts.
-- /dev/ui leaves these out of the list and shows them under "Removed" with a
-- way to put each back, which deletes the row. A session building a screen
-- reads this table and tells the critic which preferences no longer hold,
-- and the notes routine does not add a removed one again.
--
-- `taste_id` is not a foreign key: the preferences are code, not rows. A row
-- whose id is no longer in taste.ts is ignored by the page.

set search_path = public, extensions;

create table if not exists ui_taste_removals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taste_id text not null,
  removed_at timestamptz not null default now(),
  constraint ui_taste_removals_taste_id_ck
    check (taste_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(taste_id) <= 80),
  constraint ui_taste_removals_key unique (user_id, taste_id)
);

alter table ui_taste_removals enable row level security;

create policy ui_taste_removals_select on ui_taste_removals for select to authenticated
  using (user_id = (select auth.uid()));
create policy ui_taste_removals_insert on ui_taste_removals for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy ui_taste_removals_delete on ui_taste_removals for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud for the reasons 0050 gives.
revoke all on ui_taste_removals from anon;
grant select, insert, delete on ui_taste_removals to authenticated;
