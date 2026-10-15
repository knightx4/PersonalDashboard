-- The person's own details (plan #2124.1), on You's Details tab.
--
-- One row per person, keyed by user_id: phone, LinkedIn address, citizenship,
-- race, gender and sexuality, each optional and kept as they wrote it. The
-- person decided Dash may read all six (plan #2124.3).
--
-- title is the same words on every row. The sources catalogue names a row by
-- a column, and this table has no name of its own to give it.
--
-- Goals and Dash read it as a source (lib/you/sources.ts).

create table if not exists you.details (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,

  title text generated always as ('Personal details') stored,
  phone text,
  linkedin_url text,
  citizenship text,
  race text,
  gender text,
  sexuality text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint details_phone_ck check (phone is null or length(phone) <= 200),
  constraint details_linkedin_url_ck check (linkedin_url is null or length(linkedin_url) <= 500),
  constraint details_citizenship_ck check (citizenship is null or length(citizenship) <= 200),
  constraint details_race_ck check (race is null or length(race) <= 200),
  constraint details_gender_ck check (gender is null or length(gender) <= 200),
  constraint details_sexuality_ck check (sexuality is null or length(sexuality) <= 200)
);

comment on table you.details is
  'The person''s own details, one row each: phone, LinkedIn address, citizenship, race, gender and sexuality, as they wrote them. A null is a detail they have not given.';

create or replace trigger details_touch_updated_at before update on you.details
  for each row execute function you.touch_updated_at();

alter table you.details enable row level security;

create policy details_all on you.details for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on you.details to authenticated, service_role;

notify pgrst, 'reload schema';
