-- A superday is one event, not four unrelated rounds.
--
-- The interviews table models a round: a kind, a time, a panel, a debrief.
-- That is the right grain and it stays the right grain -- each conversation in
-- a superday has its own interviewer, its own hour and its own notes, and
-- collapsing them into one row would lose all three. What was missing is the
-- thing above it: four rounds on one afternoon are a single occasion, with an
-- impression of the day that belongs to none of them individually.
--
-- Hence a group rather than a flag or a shared label on the round. It is a row
-- with somewhere to write, which is the whole reason it exists; a text column
-- on interviews could cluster them but would have nowhere to put "the day went
-- well but the second conversation did not".
--
-- Membership is nullable and `on delete set null`: ungrouping a round, or
-- deleting the group, must never take the interview with it.

set search_path = job_search, extensions;

create table interview_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  -- What to call it. Seeded with the date, because that is what makes a
  -- superday one thing, and editable because "Final round" is a better name.
  label text,
  -- The impression of the occasion as a whole.
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interview_groups_application_idx on interview_groups (application_id);
create index interview_groups_user_idx on interview_groups (user_id);

alter table interviews
  add column if not exists group_id uuid references interview_groups (id) on delete set null;

create index if not exists interviews_group_idx on interviews (group_id);

create trigger interview_groups_touch_updated_at
  before update on interview_groups
  for each row execute function job_search.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The owner check has to know about the new parent, or an interview could be
-- moved into another account's group. The array is the only change; the rest
-- of the body is 0004's, restated because `create or replace` takes the whole
-- function.
-- ---------------------------------------------------------------------------
create or replace function job_search.assert_parents_same_owner()
returns trigger
language plpgsql
security definer
set search_path = job_search
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_parents text[][] := array[
    ['company_id', 'companies'],
    ['role_id', 'roles'],
    ['application_id', 'applications'],
    ['contact_id', 'contacts'],
    ['referral_contact_id', 'contacts'],
    ['interview_id', 'interviews'],
    ['group_id', 'interview_groups'],
    ['question_id', 'questions'],
    ['generated_from_question_id', 'questions'],
    ['resume_version_id', 'resume_versions'],
    ['cover_letter_id', 'cover_letters']
  ];
  v_col text;
  v_table text;
  v_value uuid;
  v_owner uuid;
  i int;
begin
  for i in 1 .. array_length(v_parents, 1) loop
    v_col := v_parents[i][1];
    v_table := v_parents[i][2];

    if not (v_row ? v_col) or v_row ->> v_col is null then
      continue;
    end if;

    v_value := (v_row ->> v_col)::uuid;
    execute format('select user_id from job_search.%I where id = $1', v_table)
      into v_owner using v_value;

    if v_owner is distinct from new.user_id then
      raise exception 'parent % belongs to another user', replace(v_col, '_id', '')
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end;
$$;

create trigger interview_groups_same_owner
  before insert or update on interview_groups
  for each row execute function job_search.assert_parents_same_owner();

alter table interview_groups enable row level security;

create policy interview_groups_select on interview_groups for select to authenticated
  using (user_id = (select auth.uid()));
create policy interview_groups_insert on interview_groups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy interview_groups_update on interview_groups for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy interview_groups_delete on interview_groups for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on interview_groups to authenticated;
grant all on interview_groups to service_role;
