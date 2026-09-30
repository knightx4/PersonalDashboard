-- The Dev workspace in search by meaning (plan #1321, under #1319).
--
-- 0136 left the Dev tables out of core.memory_sources because the title
-- search covered them. For a question about what a row or a spec says, such
-- as "where did I say the ideas list should work differently", it does not:
-- the answer is in an idea's body or a comment under it, in words the question
-- does not use. This adds the owner's ideas, notes, plan steps, raises and the
-- comments under each, and the sections of the specs in docs/.
--
-- Dev is the owner's alone (0085). Its rows are embedded only for that
-- account, under that account's id, so core.memory_chunks' row level security
-- and search_memory's owner filter keep them from anyone else. Other accounts'
-- notes, which the owner can read on /dev/bugs, are left out: they are not the
-- owner's writing. Whether the dev workspace is on is checked where recall
-- picks its sources (lib/memory/search.ts), as for every other workspace.
--
-- The sources, as find_dev_text reads them (lib/ask/dev.ts):
--   public.ideas           not dismissed. The body is Dash's when a session
--                          filed it (source 'claude'), the person's otherwise.
--   public.feedback_items  every note. The body is the person's, the
--                          resolution note Dash's.
--   public.plan_items      not dismissed. Detail, done-when and answer are the
--                          person's; the history in `comment` is Dash's.
--   public.raised_items    not dismissed, not a goal's (goal_id set). Detail
--                          and ask are Dash's.
--   docs.specs             one row per `##` section of each spec, ref
--                          `<slug>#<anchor>`, as read_spec cuts them.
-- Comments (public.dev_comments) are part of the row they sit under rather
-- than rows of their own, so a hit on a comment cites the idea, step or
-- section it belongs to, and a comment under a dismissed row goes with it.
-- Each is headed by its date; the person's go with the row's own text and
-- Dash's with Dash's, so passages keep who wrote them.
--
-- Specs are files, which SQL cannot read. The sweep reads them from docs/ and
-- writes each section's text into core.memory_documents with
-- sync_memory_documents below, so a spec edited and deployed changes that
-- table on the next tick, and the same staleness check as every other source
-- re-embeds the sections that changed. The table is bookkeeping: its rows are
-- copies of the files, not something the person wrote into the app.

set search_path = core, public, extensions;
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Who the owner is, for functions the service role runs.
--
-- public.app_owner() and public.is_owner() are granted to authenticated only,
-- and is_owner() answers for the caller, which the sweep does not have. This
-- is the owner's id or null, readable by both. It says no more than
-- app_owner() already tells any signed-in account.
-- ---------------------------------------------------------------------------
create or replace function core.dev_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id from auth.users u where lower(u.email) = public.owner_email() limit 1;
$$;

comment on function core.dev_owner_id() is
  'The owner''s user id (0085), or null when no such account exists. For the memory sweep, which runs as the service role (plan #1321).';

revoke all on function core.dev_owner_id() from public, anon;
grant execute on function core.dev_owner_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Text from files, one row per passage source.
-- ---------------------------------------------------------------------------
create table core.memory_documents (
  user_id uuid not null references auth.users (id) on delete cascade,
  source_table text not null,
  source_ref text not null,
  title text not null,
  body text not null,
  -- Whatever the sweep hashes the title and body to; compared by the sweep only.
  text_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, source_table, source_ref),
  constraint memory_documents_source_table_ck check (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  constraint memory_documents_source_ref_ck check (btrim(source_ref) <> '')
);

alter table core.memory_documents enable row level security;

create policy memory_documents_select on core.memory_documents for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.memory_documents from anon;
grant select on core.memory_documents to authenticated;
grant all on core.memory_documents to service_role;

comment on table core.memory_documents is
  'Text of files the memory sweep embeds (spec sections from docs/), copied in by the sweep because SQL cannot read files (plan #1321).';

-- The hashes the owner's copies were written with, so the sweep sends only
-- the sections that changed.
create or replace function core.memory_document_hashes(p_source_table text)
returns table (source_ref text, text_hash text)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select d.source_ref, d.text_hash
    from core.memory_documents d
   where d.user_id = core.dev_owner_id()
     and d.source_table = p_source_table
$$;

-- Bring the owner's copies of one source in line with the files: remove refs
-- not in `p_refs`, write `p_rows` ([{source_ref, title, body, text_hash}]).
-- Returns how many rows were removed or written. Nothing without an owner.
create or replace function core.sync_memory_documents(
  p_source_table text,
  p_refs text[],
  p_rows jsonb
)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_removed int;
  v_written int;
begin
  if v_owner is null then
    return 0;
  end if;

  delete from core.memory_documents d
   where d.user_id = v_owner
     and d.source_table = p_source_table
     and not (d.source_ref = any (coalesce(p_refs, '{}'::text[])));
  get diagnostics v_removed = row_count;

  insert into core.memory_documents as m
         (user_id, source_table, source_ref, title, body, text_hash, updated_at)
  select v_owner, p_source_table, r.source_ref, r.title, coalesce(r.body, ''), r.text_hash, now()
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
         as r(source_ref text, title text, body text, text_hash text)
  on conflict (user_id, source_table, source_ref) do update
     set title = excluded.title,
         body = excluded.body,
         text_hash = excluded.text_hash,
         updated_at = excluded.updated_at
   where m.text_hash is distinct from excluded.text_hash;
  get diagnostics v_written = row_count;

  return v_removed + v_written;
end;
$$;

revoke all on function core.memory_document_hashes(text) from public, anon, authenticated;
revoke all on function core.sync_memory_documents(text, text[], jsonb) from public, anon, authenticated;
grant execute on function core.memory_document_hashes(text) to service_role;
grant execute on function core.sync_memory_documents(text, text[], jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The sources: 0136's, unchanged, and the Dev ones after them.
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

      -- Dev, the owner's rows only. `cm` is the comments under the row: the
      -- person's and Dash's apart, each headed by its day.
      union all
      select i.user_id, 'public.ideas', i.id::text,
             'Idea: ' || left(split_part(btrim(coalesce(i.body, '')), E'\n', 1), 90),
             nullif(concat_ws(E'\n\n', case when i.source = 'claude' then null else i.body end, cm.mine), ''),
             nullif(concat_ws(E'\n\n', case when i.source = 'claude' then i.body end, cm.dash), '')
        from public.ideas i
        left join lateral (
          select string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author <> 'claude') as mine,
                 string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author = 'claude') as dash
            from public.dev_comments c
           where c.idea_id = i.id
        ) cm on true
       where i.dismissed_at is null
         and i.user_id = (select core.dev_owner_id())
         and (p_user_id is null or i.user_id = p_user_id)

      union all
      select fi.user_id, 'public.feedback_items', fi.id::text,
             case fi.kind::text when 'bug' then 'Bug: ' when 'feature' then 'Request: '
                                when 'like' then 'Like: ' else 'Note: ' end
               || left(split_part(btrim(coalesce(fi.body, '')), E'\n', 1), 90),
             nullif(concat_ws(E'\n\n', fi.body, cm.mine), ''),
             nullif(concat_ws(E'\n\n', 'Resolution: ' || nullif(btrim(fi.resolution_note), ''), cm.dash), '')
        from public.feedback_items fi
        left join lateral (
          select string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author <> 'claude') as mine,
                 string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author = 'claude') as dash
            from public.dev_comments c
           where c.feedback_item_id = fi.id
        ) cm on true
       where fi.user_id = (select core.dev_owner_id())
         and (p_user_id is null or fi.user_id = p_user_id)

      union all
      select pi.user_id, 'public.plan_items', pi.id::text,
             '#' || pi.number || ' ' || pi.title,
             nullif(concat_ws(E'\n\n',
               nullif(btrim(pi.detail), ''),
               'Done when: ' || nullif(btrim(pi.acceptance), ''),
               'Answer: ' || nullif(btrim(pi.resolution), ''),
               cm.mine), ''),
             nullif(concat_ws(E'\n\n', nullif(btrim(pi.comment), ''), cm.dash), '')
        from public.plan_items pi
        left join lateral (
          select string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author <> 'claude') as mine,
                 string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author = 'claude') as dash
            from public.dev_comments c
           where c.plan_item_id = pi.id
        ) cm on true
       where pi.dismissed_at is null
         and pi.user_id = (select core.dev_owner_id())
         and (p_user_id is null or pi.user_id = p_user_id)

      union all
      select ri.user_id, 'public.raised_items', ri.id::text, ri.title,
             cm.mine,
             nullif(concat_ws(E'\n\n',
               nullif(btrim(ri.detail), ''),
               'Ask: ' || nullif(btrim(ri.ask), ''),
               cm.dash), '')
        from public.raised_items ri
        left join lateral (
          select string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author <> 'claude') as mine,
                 string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author = 'claude') as dash
            from public.dev_comments c
           where c.raised_item_id = ri.id
        ) cm on true
       where ri.status <> 'dismissed'
         and ri.goal_id is null
         and ri.user_id = (select core.dev_owner_id())
         and (p_user_id is null or ri.user_id = p_user_id)

      union all
      select d.user_id, 'docs.specs', d.source_ref, d.title,
             nullif(concat_ws(E'\n\n', nullif(btrim(d.body), ''), cm.mine), ''),
             cm.dash
        from core.memory_documents d
        left join lateral (
          select string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author <> 'claude') as mine,
                 string_agg(core.memory_comment_text(c.created_at, c.body), E'\n\n' order by c.created_at, c.id)
                   filter (where c.author = 'claude') as dash
            from public.spec_sections ss
            join public.dev_comments c on c.spec_section_id = ss.id
           where ss.user_id = d.user_id
             and ss.slug || '#' || ss.anchor = d.source_ref
        ) cm on true
       where d.source_table = 'docs.specs'
         and d.user_id = (select core.dev_owner_id())
         and (p_user_id is null or d.user_id = p_user_id)
    ) s
   where s.user_id is not null
     and btrim(coalesce(s.title, '') || coalesce(s.my_text, '') || coalesce(s.dash_text, '')) <> ''
$$;

comment on function core.memory_sources(uuid) is
  'Every live row of the sources Dash searches by meaning, with the text its passages are cut from and the md5 of that text (plans #1247, #1321).';

-- A comment as it goes into its row's text: its day, then what it says.
create or replace function core.memory_comment_text(p_at timestamptz, p_body text)
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select 'Comment, ' || to_char(p_at at time zone 'UTC', 'FMDD FMMonth YYYY') || ': ' || btrim(p_body)
$$;

revoke all on function core.memory_comment_text(timestamptz, text) from public, anon;
grant execute on function core.memory_comment_text(timestamptz, text) to authenticated, service_role;

reset check_function_bodies;
