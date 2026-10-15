-- Dash's working draft of a whole application (feature #2130).
--
-- One current row per application and kind. It keeps what Dash drafted for
-- every unanswered question in one press, the questions it asked back, and
-- the person's replies, so they survive a reload and a redraft can use the
-- replies.
--
--   kind    answers       drafts holds one entry per application_answers id.
--           cover_letter  drafts holds a single entry under the key "letter".
--   drafts  { "<answer id>": { answer, evidence_item_ids, unsupported_claims } }
--   asks    [ { id, answer_id | null, question, reply | null } ]; answer_id is
--           null for a question about the application as a whole.
--
-- The draft is a working copy. What the person keeps is written to
-- application_answers or the cover letter, which are the sources, so this
-- table is listed in lib/jobs/sources.ts as not one.

set search_path = job_search, extensions;

create table if not exists application_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  kind text not null,
  drafts jsonb not null default '{}'::jsonb,
  asks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_drafts_kind_ck check (kind in ('answers', 'cover_letter')),
  constraint application_drafts_drafts_ck check (jsonb_typeof(drafts) = 'object'),
  constraint application_drafts_asks_ck check (jsonb_typeof(asks) = 'array'),
  constraint application_drafts_key unique (application_id, kind)
);

create index if not exists application_drafts_user_idx on application_drafts (user_id);

create trigger application_drafts_touch_updated_at before update on application_drafts
  for each row execute function job_search.touch_updated_at();

create trigger application_drafts_same_owner before insert or update on application_drafts
  for each row execute function job_search.assert_parents_same_owner();

alter table application_drafts enable row level security;

create policy application_drafts_select on application_drafts for select to authenticated
  using (user_id = (select auth.uid()));
create policy application_drafts_insert on application_drafts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy application_drafts_update on application_drafts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy application_drafts_delete on application_drafts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on application_drafts to authenticated;
grant all on application_drafts to service_role;
revoke all on application_drafts from anon;

notify pgrst, 'reload schema';
