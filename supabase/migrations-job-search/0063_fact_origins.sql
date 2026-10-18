-- Where each fact about a role came from (plan #2343.1).
--
-- One row per role and field, or per company and field, saying who wrote the
-- current value and how sure that source could be. The value itself stays on
-- roles or companies; this table only says where it came from, and a writer
-- replaces the row when it replaces the value.
--
--   role_id / company_id  exactly one is set. Role fields are comp (the pay
--                         range), location, work_mode, seniority and
--                         posting_status; the company field is stage.
--   origin                posting (the posting reader), recruiter_email (the
--                         mail import), dash (Dash read or worked it out),
--                         you (typed by the person), or unknown (saved before
--                         origins were kept, and nothing says where from)
--   certainty             firsthand, secondhand or guess; null exactly when
--                         origin is unknown, since nothing is known of it
--   message_id            the mail it came from (core.ingested_messages)
--   source_url            the page it came from
--   recorded_at           when the origin was written
--
-- Backfill: the owner's existing pay maps from roles.comp_source (posted to
-- posting and firsthand, recruiter to recruiter_email and secondhand,
-- estimate to dash and guess). Every other fact already saved, and pay with
-- no comp_source, is recorded as unknown rather than given an origin nobody
-- knows. Written against the owner's id only.

set search_path = job_search, extensions;

create table if not exists fact_origins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid references roles (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade,
  field text not null,
  origin text not null,
  certainty text,
  message_id uuid references core.ingested_messages (id) on delete set null,
  source_url text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fact_origins_subject_ck check ((role_id is null) <> (company_id is null)),
  constraint fact_origins_field_ck check (
    (role_id is not null and field in ('comp', 'location', 'work_mode', 'seniority', 'posting_status'))
    or (company_id is not null and field in ('stage'))
  ),
  constraint fact_origins_origin_ck check (origin in ('posting', 'recruiter_email', 'dash', 'you', 'unknown')),
  constraint fact_origins_certainty_ck check (certainty in ('firsthand', 'secondhand', 'guess')),
  constraint fact_origins_unknown_ck check ((origin = 'unknown') = (certainty is null))
);

create unique index if not exists fact_origins_role_field_key
  on fact_origins (role_id, field) where role_id is not null;
create unique index if not exists fact_origins_company_field_key
  on fact_origins (company_id, field) where company_id is not null;
create index if not exists fact_origins_user_idx on fact_origins (user_id);
create index if not exists fact_origins_message_idx on fact_origins (message_id) where message_id is not null;

create trigger fact_origins_touch_updated_at before update on fact_origins
  for each row execute function job_search.touch_updated_at();

create trigger fact_origins_same_owner before insert or update on fact_origins
  for each row execute function job_search.assert_parents_same_owner();

alter table fact_origins enable row level security;

create policy fact_origins_select on fact_origins for select to authenticated
  using (user_id = (select auth.uid()));
create policy fact_origins_insert on fact_origins for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy fact_origins_update on fact_origins for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy fact_origins_delete on fact_origins for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on fact_origins to authenticated;
grant all on fact_origins to service_role;
revoke all on fact_origins from anon;

-- ---------------------------------------------------------------------------
-- Backfill, the owner's rows only.
-- ---------------------------------------------------------------------------
insert into fact_origins (user_id, role_id, field, origin, certainty)
select r.user_id, r.id, 'comp',
  case r.comp_source
    when 'posted' then 'posting'
    when 'recruiter' then 'recruiter_email'
    when 'estimate' then 'dash'
    else 'unknown'
  end,
  case r.comp_source
    when 'posted' then 'firsthand'
    when 'recruiter' then 'secondhand'
    when 'estimate' then 'guess'
  end
from roles r
where r.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and (r.comp_min_cents is not null or r.comp_max_cents is not null or r.comp_source is not null)
on conflict do nothing;

insert into fact_origins (user_id, role_id, field, origin)
select r.user_id, r.id, f.field, 'unknown'
from roles r
cross join lateral (values
  ('location', r.location is not null and btrim(r.location) <> ''),
  ('work_mode', r.work_mode is not null),
  ('seniority', r.seniority is not null and btrim(r.seniority) <> ''),
  ('posting_status', r.posting_status <> 'unknown')
) as f (field, present)
where r.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and f.present
on conflict do nothing;

insert into fact_origins (user_id, company_id, field, origin)
select c.user_id, c.id, 'stage', 'unknown'
from companies c
where c.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
  and c.stage is not null and btrim(c.stage) <> ''
on conflict do nothing;

notify pgrst, 'reload schema';
