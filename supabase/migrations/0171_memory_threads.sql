-- What the person said to Dash in any thread is a memory source (plan #1466).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 6: the person's turns in threads and in
-- Ask become a memory source, so what they told Dash on a role page or a goal
-- can be recalled from Ask a week later. Every thread is kept in
-- core.conversations (plan #1470), and the threads under an idea, a note, a
-- plan row, a raise and a spec section are already folded into that row's
-- text (0170). This adds one source, `core.conversations`, for every other
-- thread: one row per conversation, its source_ref the conversation's
-- subject_ref, so a row thread is named by the row's ref and an Ask
-- conversation by its own id, which is what /ask/<id> opens.
--
--   row threads   the person's turns as their text and Dash's as Dash's,
--                 each headed by its day, titled by the row they sit under.
--                 A role's turns copied from job_search.notes (0169 kept the
--                 note's id as the turn's) are left out: those notes are
--                 searched as job_search.notes already.
--   Ask           the person's questions only. Dash's answers are made from
--                 the other sources and would only repeat them.
--
-- The function below is 0170's with that branch added before the Dev rows.

set search_path = core, public, extensions;
set check_function_bodies = off;

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

      union all
      select t.user_id, 'obsidian.transcripts', t.id::text,
             'Transcript from ' || t.school,
             cs.text, null
        from obsidian.transcripts t
        join lateral (
          select string_agg(
                   concat_ws(', ',
                     concat_ws(' ', nullif(btrim(c.code), ''), c.title),
                     case
                       when nullif(btrim(c.term), '') is null then c.year::text
                       when c.year is null or strpos(c.term, c.year::text) > 0 then btrim(c.term)
                       else btrim(c.term) || ' ' || c.year
                     end,
                     trim_scale(c.credits)::text
                       || case when c.credits = 1 then ' credit' else ' credits' end,
                     'grade ' || nullif(btrim(c.grade), ''),
                     case when c.school <> t.school then 'at ' || c.school end),
                   E'\n' order by c.position, c.id) as text
            from obsidian.courses c
           where c.transcript_id = t.id
             and c.user_id = t.user_id
        ) cs on cs.text is not null
       where (p_user_id is null or t.user_id = p_user_id)

      -- Threads (plan #1466): every conversation not folded into a row
      -- above or below. `rid` is the id half of a row thread's ref.
      union all
      select c.user_id, 'core.conversations', c.subject_ref,
             case when c.subject_kind = 'ask'
                  then coalesce(nullif(btrim(c.title), ''), 'Question to Dash') || ', '
                         || to_char(c.created_at at time zone 'UTC', 'FMDD FMMonth YYYY')
                  else 'Thread on ' || coalesce(named.name, 'a row in ' || split_part(c.subject_ref, ':', 1))
             end,
             turns.mine,
             case when c.subject_kind = 'row' then turns.dash end
        from core.conversations c
        cross join lateral (
          select split_part(c.subject_ref, ':', 1) as tbl,
                 substr(c.subject_ref, strpos(c.subject_ref, ':') + 1) as rid
        ) r
        left join lateral (
          select case r.tbl
                   when 'goals.items' then (select g.title from goals.items g where g.id = r.rid::uuid)
                   when 'job_search.roles' then (
                     select jr.title || coalesce(' at ' || jc.name, '')
                       from job_search.roles jr
                       left join job_search.companies jc on jc.id = jr.company_id
                      where jr.id = r.rid::uuid)
                   when 'core.files' then (select f.title from core.files f where f.id = r.rid::uuid)
                   when 'learn.feed_cards' then (
                     select coalesce(nullif(btrim(fc.idea_name), ''), nullif(btrim(fc.named_article), ''),
                                     nullif(btrim(fc.theme_name), ''))
                       from learn.feed_cards fc where fc.id = r.rid::uuid)
                   when 'todo.tasks' then (select tt.title from todo.tasks tt where tt.id = r.rid::uuid)
                   when 'public.orders' then (
                     select concat_ws(' ', 'the order', 'from ' || m.name,
                                      'on ' || to_char(o.order_date, 'FMDD FMMonth YYYY'))
                       from public.orders o
                       left join public.merchants m on m.id = o.merchant_id
                      where o.id = r.rid::uuid)
                   when 'public.inventory_items' then (
                     select ii.name from public.inventory_items ii where ii.id = r.rid::uuid)
                   when 'news.saved_stories' then (
                     select ns.headline from news.saved_stories ns where ns.id = r.rid::uuid)
                   when 'obsidian.notes' then (
                     select coalesce(nullif(btrim(n.title), ''), n.path) from obsidian.notes n where n.id = r.rid::uuid)
                   when 'public.spec_changes' then (
                     select sc.title from public.spec_changes sc where sc.id = r.rid::uuid)
                   when 'public.inspiration_takeaways' then (
                     select it.title from public.inspiration_takeaways it where it.id = r.rid::uuid)
                 end as name
        ) named on c.subject_kind = 'row'
        cross join lateral (
          select string_agg(core.memory_comment_text(t.created_at, t.body), E'\n\n' order by t.created_at, t.id)
                   filter (where t.role = 'user') as mine,
                 string_agg(core.memory_comment_text(t.created_at, t.body), E'\n\n' order by t.created_at, t.id)
                   filter (where t.role <> 'user') as dash
            from core.conversation_turns t
           where t.conversation_id = c.id
             and t.user_id = c.user_id
             and not (r.tbl = 'job_search.roles'
                      and exists (select 1 from job_search.notes jn where jn.id = t.id))
        ) turns
       where (c.subject_kind = 'ask'
              or (c.subject_kind = 'row'
                  and r.tbl not in ('public.ideas', 'public.feedback_items', 'public.plan_items',
                                    'public.raised_items', 'public.spec_sections')))
         and (turns.mine is not null or (c.subject_kind = 'row' and turns.dash is not null))
         and (p_user_id is null or c.user_id = p_user_id)

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
            from core.thread_turns c
           where c.ref = 'public.ideas:' || i.id and c.user_id = i.user_id
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
            from core.thread_turns c
           where c.ref = 'public.feedback_items:' || fi.id and c.user_id = fi.user_id
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
            from core.thread_turns c
           where c.ref = 'public.plan_items:' || pi.id and c.user_id = pi.user_id
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
            from core.thread_turns c
           where c.ref = 'public.raised_items:' || ri.id and c.user_id = ri.user_id
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
            join core.thread_turns c on c.ref = 'public.spec_sections:' || ss.id and c.user_id = ss.user_id
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
  'Every live row of the sources Dash searches by meaning, with the text its passages are cut from and the md5 of that text (plans #1247, #1321, #1309). Comments on dev rows come from core.thread_turns (plan #1470); every other thread and Ask conversation is the core.conversations source (plan #1466).';

reset check_function_bodies;
