-- Dash and the People bots poll one of the app's own routes in the background
-- (plan #3070.3, under #3070).
--
-- run_app_route (lib/dash/app-route-writes.ts) calls an allowlisted route once
-- through lib/dev/app-route.ts. Given poll_until, it keeps a row here instead
-- of waiting in the chat turn, and every minute /api/cron/app-route-polls
-- (lib/dev/app-route-polls.ts) calls the route again for each row that is due,
-- until the named field of its JSON is true, a call fails, or the time runs
-- out. Then the final JSON and a line of its numbers go as Dash's comment on
-- the plan step or raise the row names, and one line into the chat it was
-- asked from: Dash's turn in an Ask Dash conversation, or the bot's text in a
-- People thread (its speaker in a group), as core.say_in_handoff_thread
-- (0313) posts.
--
--   public.app_route_polls
--                one background poll: who asked, the path, the query of the
--                first call and of the calls after it, the field it waits
--                on, how often and until when, where the finish is posted,
--                and how it stands (polling, done, timed_out, failed) with
--                the calls made, the last run (public.app_route_runs, 0315)
--                and the last result.
--   public.claim_app_route_polls(limit, lease_seconds)
--                takes the owner's due polls for one pass, leasing each so
--                two passes at once never call the same row twice.
--   public.say_in_app_route_thread(poll, text)
--                posts the finish line into the chat the poll came from.
--
-- The tool is the owner's alone, so the functions read and write only the
-- rows of core.dev_owner_id(). It also adds run_app_route to the kinds an Ask
-- Dash record may carry, reading the list as it stands, as 0297 did. New
-- table and functions: no existing row is changed.

set search_path = public, extensions;

create table if not exists app_route_polls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asked_by text not null,
  path text not null,
  query jsonb not null default '{}'::jsonb,
  then_query jsonb not null default '{}'::jsonb,
  poll_until text not null,
  every_seconds integer not null default 90,
  deadline timestamptz not null,
  next_at timestamptz not null default now(),
  claimed_until timestamptz,
  post_to_ref text,
  post_to_label text,
  conversation_id uuid,
  advisor_chat_id uuid,
  advisor_id uuid,
  status text not null default 'polling',
  calls integer not null default 0,
  last_run_id uuid references app_route_runs (id) on delete set null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint app_route_polls_asked_by_ck check (length(btrim(asked_by)) between 1 and 200),
  constraint app_route_polls_path_ck check (length(path) between 1 and 500),
  constraint app_route_polls_query_ck check (jsonb_typeof(query) = 'object' and jsonb_typeof(then_query) = 'object'),
  constraint app_route_polls_until_ck check (poll_until ~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' and length(poll_until) <= 200),
  constraint app_route_polls_every_ck check (every_seconds between 30 and 3600),
  constraint app_route_polls_status_ck check (status in ('polling', 'done', 'timed_out', 'failed')),
  constraint app_route_polls_finished_ck check ((status = 'polling') = (finished_at is null)),
  constraint app_route_polls_post_to_ck check (
    post_to_ref is null or post_to_ref ~ '^public\.(plan_items|raised_items):[0-9a-f-]{36}$'
  ),
  constraint app_route_polls_error_ck check (error is null or length(error) <= 2000)
);

create index if not exists app_route_polls_due_idx on app_route_polls (user_id, next_at)
  where status = 'polling';

alter table app_route_polls enable row level security;

create policy app_route_polls_owner_read on app_route_polls for select to authenticated
  using (user_id = (select auth.uid()));

grant select on app_route_polls to authenticated;
revoke all on table app_route_polls from anon;

comment on table app_route_polls is
  'One background poll of an app route that Dash or a bot started with run_app_route, until a JSON field is true or time runs out (migration 0316).';

create or replace function public.claim_app_route_polls(p_limit integer, p_lease_seconds integer)
returns setof public.app_route_polls
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.app_route_polls p
     set claimed_until = now() + make_interval(secs => greatest(p_lease_seconds, 30))
   where p.id in (
     select q.id
       from public.app_route_polls q
      where q.user_id = core.dev_owner_id()
        and q.status = 'polling'
        and q.next_at <= now()
        and (q.claimed_until is null or q.claimed_until < now())
      order by q.next_at
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning p.*;
end;
$$;

create or replace function public.say_in_app_route_thread(p_poll uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.app_route_polls;
  v_kind text;
  v_speaker uuid;
  v_id uuid;
begin
  if p_text is null or btrim(p_text) = '' then
    raise exception 'there is nothing to say';
  end if;

  select * into v_row from public.app_route_polls
   where id = p_poll and user_id = core.dev_owner_id();
  if not found then
    return null;
  end if;

  if v_row.conversation_id is not null then
    if exists (
      select 1 from core.conversations c where c.id = v_row.conversation_id and c.user_id = v_row.user_id
    ) then
      insert into core.conversation_turns (conversation_id, user_id, role, body)
      values (v_row.conversation_id, v_row.user_id, 'assistant', btrim(p_text))
      returning id into v_id;
    end if;
  elsif v_row.advisor_chat_id is not null then
    select c.kind into v_kind from you.advisor_chats c where c.id = v_row.advisor_chat_id and c.user_id = v_row.user_id;
    if v_kind is not null then
      if v_kind = 'group' then
        v_speaker := v_row.advisor_id;
      end if;
      insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text)
      values (v_row.user_id, v_row.advisor_chat_id, 'advisor', 'reply', v_speaker, btrim(p_text))
      returning id into v_id;
    end if;
  end if;
  return v_id;
end;
$$;

comment on function public.say_in_app_route_thread(uuid, text) is
  'Posts one line into the chat an owner''s app-route poll came from, as Dash or as the bot that started it (plan #3070.3).';

revoke all on function public.claim_app_route_polls(integer, integer) from public, anon, authenticated;
revoke all on function public.say_in_app_route_thread(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_app_route_polls(integer, integer) to service_role;
grant execute on function public.say_in_app_route_thread(uuid, text) to service_role;

-- run_app_route among the kinds an Ask Dash record may carry, read from the
-- constraint as it stands so no kind another step added is lost (as 0297).
do $$
declare
  def text;
  kinds text[];
  listed text;
begin
  select pg_get_constraintdef(c.oid)
    into def
    from pg_constraint c
   where c.conrelid = 'core.dash_actions'::regclass
     and c.conname = 'dash_actions_kind_ck';

  if def is null then
    raise exception 'dash_actions_kind_ck was not found';
  end if;

  select coalesce(array_agg(distinct k), '{}')
    into kinds
    from (
      select unnest(string_to_array(m[1], ',')) as k
        from regexp_matches(def, '''\{([a-z0-9_,]*)\}''::text\[\]', 'g') as m
      union
      select m[1]
        from regexp_matches(def, '''([a-z][a-z0-9_]*)''::text(?!\[)', 'g') as m
    ) s
   where k ~ '^[a-z][a-z0-9_]*$' and k <> 'ask';

  if cardinality(kinds) < 80 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the full list', cardinality(kinds);
  end if;

  select string_agg(quote_literal(k), ', ' order by k)
    into listed
    from (select distinct k from unnest(kinds || array['run_app_route']) as k) s;

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute
    'alter table core.dash_actions add constraint dash_actions_kind_ck check ('
    || 'kind ~ ''^[a-z][a-z0-9_]*$'' and (surface <> ''ask'' or kind in (' || listed || ')))';
end;
$$;

-- The schedule: every minute, so a poll every 90 seconds is called within a
-- minute of when it is due. The origin and the secret come from Supabase
-- Vault at fire time (app_origin, cron_secret), as 0313 reads them. Guarded
-- so the local test database, which has neither extension, still applies it.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the app route poll schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'app-route-polls-minute'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'app-route-polls-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/app-route-polls',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $job$
    )
  $schedule$;
end;
$$;

notify pgrst, 'reload schema';
