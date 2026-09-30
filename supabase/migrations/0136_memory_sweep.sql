-- What goes into core.memory_chunks, and the clock that keeps it current
-- (plan #1247, under #1245).
--
-- 0135 made the table and the search. This says which rows of which tables
-- are embedded and as what text, which of them need embedding again, how the
-- passages are written back, and when passages of a row that is gone are
-- removed. The sweep that calls these is lib/memory/sweep.ts, run every five
-- minutes by /api/cron/memory-sweep.
--
-- core.memory_sources is the one definition of each source's text, as
-- obsidian.note_embedding_text is for whole notes. A row gives a title, the
-- person's text and Dash's text (either may be null), and source_hash, the
-- md5 of all three. The sweep cuts the texts into passages of about 1,500
-- characters (lib/memory/passages.ts) and never builds the hash itself, so
-- the read, the write and the staleness check cannot disagree about what a
-- row says.
--
-- The first sources, and what counts as live:
--   obsidian.notes         not deleted, not a stub (under 20 characters of
--                          prose, as 0023 of migrations-vault), not a template
--                          or an instruction file (as 0024). Ref is the path,
--                          as the catalogue gives it.
--   job_search.thoughts    every entry.
--   job_search.notes       every note; author 'claude' is Dash's.
--   job_search.profiles    what the profile says they want and how they
--                          write, when any of it is filled in. Ref is the
--                          owner's id.
--   goals.items            not archived, dismissed or merged away. Title and
--                          detail are the person's; the result is Dash's.
--   goals.captures         every capture.
--   core.files             not archived; made_by 'you' is the person's, the
--                          rest Dash's.
--   learn.aims             not archived.
--   learn.card_notes       every note.
--   learn.feed_cards       every card the feed has not dropped; all Dash's.
--   public.order_items     items of orders neither deleted nor cancelled, as
--                          one line of name, variant, merchant and date.
--
-- A row is stale when it has no passages, when any passage carries another
-- hash, or when it has fewer passages than it was cut into. The last case is
-- a long row whose passages were written over several calls and interrupted:
-- chunk_count, added here, records how many there should be.
--
-- Most of these functions name tables in schemas that later migration folders
-- create (scripts/db-reset.sh applies this folder first), so bodies are not
-- checked at creation. They are checked when first called.

set search_path = core, public, extensions;
set check_function_bodies = off;

-- The table is empty when this is applied (the sweep below is its first
-- writer), so the column can be required from the start.
alter table core.memory_chunks add column chunk_count int not null;
alter table core.memory_chunks
  add constraint memory_chunks_chunk_count_ck check (chunk_index < chunk_count);

comment on column core.memory_chunks.chunk_count is
  'How many passages the source row was cut into; fewer rows than this means an interrupted write, and the row is embedded again.';

-- ---------------------------------------------------------------------------
-- Every live row of the first sources, with its text and hash.
--
-- `p_user_id` null means every owner, which only the service role sees; a
-- signed-in caller sees their own rows through each table's RLS either way.
-- ---------------------------------------------------------------------------
create or replace function core.memory_sources(p_user_id uuid default null)
returns table (
  user_id uuid,
  source_table text,
  source_ref text,
  title text,
  my_text text,
  dash_text text,
  source_hash text
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select s.user_id, s.source_table, s.source_ref, s.title, s.my_text, s.dash_text,
         md5(concat_ws(chr(31), s.title, coalesce(s.my_text, ''), coalesce(s.dash_text, '')))
    from (
      select n.user_id, 'obsidian.notes' as source_table, n.path as source_ref,
             coalesce(nullif(btrim(n.title), ''), n.path) as title,
             n.body as my_text, null::text as dash_text
        from obsidian.notes n
       where n.deleted_at is null
         and (p_user_id is null or n.user_id = p_user_id)
         and n.path !~* '(^|/)templates/'
         and n.path !~* '(^|/)(claude|agents)\.md$'
         and obsidian.note_prose_chars(n.body) >= 20

      union all
      select t.user_id, 'job_search.thoughts', t.id::text,
             'Job search thoughts, ' || to_char(t.created_at at time zone 'UTC', 'FMDD Month YYYY'),
             t.body, null
        from job_search.thoughts t
       where (p_user_id is null or t.user_id = p_user_id)

      union all
      select jn.user_id, 'job_search.notes', jn.id::text,
             coalesce('Note on ' || r.title || coalesce(' at ' || c.name, ''),
                      'Note on ' || c.name,
                      'Job search note'),
             case when jn.author = 'claude' then null else jn.body end,
             case when jn.author = 'claude' then jn.body end
        from job_search.notes jn
        left join job_search.roles r on r.id = jn.role_id
        left join job_search.companies c on c.id = coalesce(jn.company_id, r.company_id)
       where (p_user_id is null or jn.user_id = p_user_id)

      union all
      select p.id, 'job_search.profiles', p.id::text, 'Job search profile', said.text, null
        from job_search.profiles p
       cross join lateral (
         select nullif(concat_ws(E'\n',
                  'Target titles: ' || nullif(array_to_string(p.target_titles, ', '), ''),
                  'Home: ' || nullif(btrim(p.home_location), ''),
                  'Workplace: ' || nullif(array_to_string(p.workplace_preferences, ', '), ''),
                  'Company stages: ' || nullif(array_to_string(p.company_stages, ', '), ''),
                  'Industries to avoid: ' || nullif(array_to_string(p.excluded_industries, ', '), ''),
                  'Writing style: ' || nullif(btrim(p.writing_style_notes), '')
                ), '') as text
       ) said
       -- A profile nobody has filled in says nothing; its title alone is not a passage.
       where said.text is not null
         and (p_user_id is null or p.id = p_user_id)

      union all
      select g.user_id, 'goals.items', g.id::text, g.title, g.detail, g.result
        from goals.items g
       where g.archived_at is null
         and g.dismissed_at is null
         and g.merged_into is null
         and (p_user_id is null or g.user_id = p_user_id)

      union all
      select gc.user_id, 'goals.captures', gc.id::text,
             'Capture, ' || to_char(gc.created_at at time zone 'UTC', 'FMDD Month YYYY'),
             gc.body, null
        from goals.captures gc
       where (p_user_id is null or gc.user_id = p_user_id)

      union all
      select f.user_id, 'core.files', f.id::text, f.title,
             case when f.made_by = 'you' then concat_ws(E'\n\n', f.summary, f.body) end,
             case when f.made_by = 'you' then null else concat_ws(E'\n\n', f.summary, f.body) end
        from core.files f
       where f.archived_at is null
         and (p_user_id is null or f.user_id = p_user_id)

      union all
      select a.user_id, 'learn.aims', a.id::text, a.name, a.about, null
        from learn.aims a
       where a.archived_at is null
         and (p_user_id is null or a.user_id = p_user_id)

      union all
      select cn.user_id, 'learn.card_notes', cn.id::text,
             coalesce('Note on ' || k.name, 'Learn note'), cn.body, null
        from learn.card_notes cn
        left join learn.concepts k on k.id = cn.concept_id
       where (p_user_id is null or cn.user_id = p_user_id)

      union all
      select fc.user_id, 'learn.feed_cards', fc.id::text,
             coalesce(nullif(btrim(fc.idea_name), ''), nullif(btrim(fc.named_article), ''),
                      nullif(btrim(fc.theme_name), ''), 'Learn card'),
             null,
             nullif(concat_ws(E'\n\n', fc.hook, fc.summary, fc.takeaway, fc.example, fc.why), '')
        from learn.feed_cards fc
       where fc.status <> 'dropped'
         and (p_user_id is null or fc.user_id = p_user_id)

      union all
      select o.user_id, 'public.order_items', oi.id::text,
             coalesce(nullif(btrim(oi.short_name), ''), oi.name),
             concat_ws(', ',
               'Bought ' || oi.name,
               nullif(btrim(oi.variant), ''),
               'from ' || m.name,
               'on ' || to_char(o.order_date, 'FMDD Month YYYY')),
             null
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join public.merchants m on m.id = o.merchant_id
       where o.deleted_at is null
         and o.cancelled_at is null
         and (p_user_id is null or o.user_id = p_user_id)
    ) s
   where s.user_id is not null
     and btrim(coalesce(s.title, '') || coalesce(s.my_text, '') || coalesce(s.dash_text, '')) <> ''
$$;

comment on function core.memory_sources(uuid) is
  'Every live row of the sources Dash searches by meaning, with the text its passages are cut from and the md5 of that text (plan #1247).';

-- ---------------------------------------------------------------------------
-- The rows whose passages are missing, out of date or incomplete.
--
-- Ordered by owner, so a run's spend groups by the account it belongs to, and
-- the vault last within an owner, so the small sources are done first on the
-- backfill.
-- ---------------------------------------------------------------------------
create or replace function core.stale_memory_sources(p_limit int, p_user_id uuid default null)
returns table (
  user_id uuid,
  source_table text,
  source_ref text,
  title text,
  my_text text,
  dash_text text,
  source_hash text
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with have as materialized (
    select c.user_id, c.source_table, c.source_ref,
           count(*) as n,
           min(c.chunk_count) as fewest, max(c.chunk_count) as most,
           min(c.source_hash) as lo, max(c.source_hash) as hi
      from core.memory_chunks c
     where p_user_id is null or c.user_id = p_user_id
     group by c.user_id, c.source_table, c.source_ref
  )
  select s.user_id, s.source_table, s.source_ref, s.title, s.my_text, s.dash_text, s.source_hash
    from core.memory_sources(p_user_id) s
    left join have h
      on h.user_id = s.user_id and h.source_table = s.source_table and h.source_ref = s.source_ref
   where h.n is null
      or h.lo <> s.source_hash or h.hi <> s.source_hash
      or h.fewest <> h.most or h.n <> h.fewest
   order by s.user_id, s.source_table = 'obsidian.notes', s.source_table, s.source_ref
   limit greatest(coalesce(p_limit, 16), 1)
$$;

comment on function core.stale_memory_sources(int, uuid) is
  'Rows of core.memory_sources whose passages are missing, carry another hash, or are fewer than the row was cut into (plan #1247).';

-- ---------------------------------------------------------------------------
-- Writing passages.
--
-- `p_rows` is a JSON array of
--   {user_id, source_table, source_ref, source_hash, chunk_count, model,
--    replace, chunks: [{chunk_index, author, body, embedding}]}
-- with `embedding` as the `[0.1,0.2,...]` literal pgvector parses.
--
-- `replace` true removes every passage the row had first, so a row that was
-- cut differently leaves nothing of its old self behind. A long row may be
-- written over several calls: the first with replace true, the rest adding
-- to it. Passages at or past chunk_count are removed either way, which is
-- what drops the tail of a row that got shorter.
--
-- The source is not re-read here. Passages carry the hash of the text they
-- were cut from, so a row edited while it was being embedded is found stale
-- on the next read and done again. Returns how many passages were written.
-- ---------------------------------------------------------------------------
create or replace function core.store_memory_chunks(p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_written int;
begin
  with incoming as (
    select *
      from jsonb_to_recordset(p_rows) as r(
        user_id uuid, source_table text, source_ref text, source_hash text,
        chunk_count int, model text, replace boolean, chunks jsonb)
  )
  delete from core.memory_chunks c
   using incoming i
   where c.user_id = i.user_id
     and c.source_table = i.source_table
     and c.source_ref = i.source_ref
     and (coalesce(i.replace, false) or c.chunk_index >= i.chunk_count);

  insert into core.memory_chunks as m
         (user_id, source_table, source_ref, chunk_index, chunk_count, author, body,
          source_hash, embedding, embedding_model, embedded_at)
  select r.user_id, r.source_table, r.source_ref, ch.chunk_index, r.chunk_count, ch.author,
         ch.body, r.source_hash, ch.embedding::extensions.vector, r.model, now()
    from jsonb_to_recordset(p_rows) as r(
           user_id uuid, source_table text, source_ref text, source_hash text,
           chunk_count int, model text, replace boolean, chunks jsonb)
   cross join lateral jsonb_to_recordset(r.chunks) as ch(
           chunk_index int, author text, body text, embedding text)
  on conflict on constraint memory_chunks_key do update
     set chunk_count = excluded.chunk_count,
         author = excluded.author,
         body = excluded.body,
         source_hash = excluded.source_hash,
         embedding = excluded.embedding,
         embedding_model = excluded.embedding_model,
         embedded_at = excluded.embedded_at;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function core.store_memory_chunks(jsonb) is
  'Write the passages of source rows, replacing what each row had (plan #1247).';

-- ---------------------------------------------------------------------------
-- Removing the passages of rows that are no longer live: deleted, archived,
-- dismissed, renamed (a note's ref is its path) or turned into a stub.
-- Returns how many passages were removed.
-- ---------------------------------------------------------------------------
create or replace function core.prune_memory_chunks(p_user_id uuid default null)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_removed int;
begin
  with live as materialized (
    select s.user_id, s.source_table, s.source_ref
      from core.memory_sources(p_user_id) s
  )
  delete from core.memory_chunks c
   where (p_user_id is null or c.user_id = p_user_id)
     and not exists (
       select 1 from live l
        where l.user_id = c.user_id
          and l.source_table = c.source_table
          and l.source_ref = c.source_ref
     );

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

comment on function core.prune_memory_chunks(uuid) is
  'Delete the passages of rows no longer in core.memory_sources (plan #1247).';

revoke all on function core.memory_sources(uuid) from public, anon;
revoke all on function core.stale_memory_sources(int, uuid) from public, anon;
revoke all on function core.store_memory_chunks(jsonb) from public, anon;
revoke all on function core.prune_memory_chunks(uuid) from public, anon;
grant execute on function core.memory_sources(uuid) to authenticated, service_role;
grant execute on function core.stale_memory_sources(int, uuid) to authenticated, service_role;
grant execute on function core.store_memory_chunks(jsonb) to authenticated, service_role;
grant execute on function core.prune_memory_chunks(uuid) to authenticated, service_role;

reset check_function_bodies;

-- ---------------------------------------------------------------------------
-- The clock: every five minutes, as the map sweep's (0094), through pg_cron
-- and pg_net because Vercel's free plan allows one cron a day. The origin and
-- secret come from Supabase Vault under the names 0078 already requires.
-- A call stops starting work after three and a half minutes, so two calls do
-- not overlap. Guarded on the extensions so the local test database, which
-- has neither, still resets.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the memory sweep schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'memory-sweep-tick'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'memory-sweep-tick',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/memory-sweep',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 295000
        )
      $job$
    )
  $schedule$;
end;
$$;
