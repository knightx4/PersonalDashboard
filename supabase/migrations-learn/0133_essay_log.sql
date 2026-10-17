-- What happens while an essay is worked out (LEARN-ESSAYS-SPEC, "The
-- stages", and "Measuring the tool"): which stages were opened and when,
-- and every model call the stages made with the response it got back.
--
-- learn.essay_log, one row per event:
--   essay_id   the essay. Removed with it.
--   kind       'stage' (a stage was opened) or 'call' (a model call ran).
--   stage      the stage it happened in: discover, research, plan,
--              structure, develop or write.
--   action     for a call, the spend operation it ran under, such as
--              'research-essay-question' or 'find-point-evidence'.
--   payload    for a call: the model, the prompt it was given and the
--              response's content blocks, with the encrypted search
--              payloads left out. Replayed by the tests as recorded
--              fixtures, so the parsers are checked against what the API
--              really returns.
-- Bookkeeping about how the tool was used, so not a source.

set search_path = learn, public, extensions;

create table if not exists learn.essay_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  kind text not null,
  stage text,
  action text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint essay_log_essay_fk
    foreign key (essay_id, user_id) references learn.essays (id, user_id)
    on delete cascade,
  constraint essay_log_kind_check check (kind in ('stage', 'call')),
  constraint essay_log_stage_check check (
    stage is null or stage in ('discover', 'research', 'plan', 'structure', 'develop', 'write')
  ),
  constraint essay_log_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists essay_log_essay_idx on learn.essay_log (essay_id, created_at);
create index if not exists essay_log_user_idx on learn.essay_log (user_id);

alter table learn.essay_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'essay_log' and policyname = 'essay_log_all'
  ) then
    create policy essay_log_all on learn.essay_log for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.essay_log from anon, authenticated;
grant select, insert, update, delete on learn.essay_log to authenticated, service_role;

comment on table learn.essay_log is
  'What happened while an essay was worked out: stages opened, and each model call with its response, for drop-off and for replaying real responses in tests.';
