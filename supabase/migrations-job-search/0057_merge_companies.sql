-- Fold one company into another.
--
-- Heron and Heron Data were one employer recorded twice: the board import
-- filed it under its Ashby name, Find added it again as Heron, and an
-- interview email then opened a new role under the second row.
--
-- merge_companies(keep, merge)
--   Moves everything that points at `merge` onto `keep` in one transaction,
--   fills the kept row's empty fields from the merged one, unions the domains
--   and deletes the merged row. The tables it moves are read from the foreign
--   keys at run time rather than listed here, so a table added later that
--   points at companies is carried along without this function changing.
--   Security invoker: row-level security decides what the caller can move.
--
--   Two unique keys can collide on the way:
--     contacts (user_id, company_id, lower(full_name)): the same person at
--       both companies is one person. Their rows are folded the same way,
--       through the foreign keys that point at contacts.
--     roles (user_id, company_id, jd_hash): the same posting saved at both.
--       The moved role's jd_hash is cleared so both rows survive the move,
--       and the pair can then be merged as roles on the company page.

set search_path = job_search, extensions;

create or replace function job_search.merge_companies(p_keep uuid, p_merge uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  kept job_search.companies%rowtype;
  gone job_search.companies%rowtype;
  fk record;
  pair record;
  moved jsonb := '{}'::jsonb;
  n integer;
begin
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Pick a different company to merge.' using errcode = '22023';
  end if;

  select * into kept from job_search.companies where id = p_keep for update;
  select * into gone from job_search.companies where id = p_merge for update;
  if kept.id is null or gone.id is null then
    raise exception 'One of those companies no longer exists.' using errcode = 'P0002';
  end if;
  if kept.user_id <> gone.user_id then
    raise exception 'Those companies belong to different people.' using errcode = '42501';
  end if;

  -- The same person at both companies: fold the merged company's contact into
  -- the kept one before the move would collide on the name.
  for pair in
    select g.id as gone_id, k.id as keep_id
    from job_search.contacts g
    join job_search.contacts k
      on k.user_id = g.user_id and k.company_id = p_keep and lower(k.full_name) = lower(g.full_name)
    where g.company_id = p_merge
  loop
    update job_search.contacts k set
      title = coalesce(k.title, g.title),
      linkedin_url = coalesce(k.linkedin_url, g.linkedin_url),
      email = coalesce(k.email, g.email),
      how_we_connect = coalesce(k.how_we_connect, g.how_we_connect),
      notes = case
        when k.notes is null then g.notes
        when g.notes is null or g.notes = k.notes then k.notes
        else k.notes || E'\n\n' || g.notes
      end
    from job_search.contacts g
    where k.id = pair.keep_id and g.id = pair.gone_id;

    for fk in
      select c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'job_search.contacts'::regclass and c.contype = 'f'
        and pg_catalog.array_length(c.conkey, 1) = 1
    loop
      execute pg_catalog.format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
        using pair.keep_id, pair.gone_id;
    end loop;

    delete from job_search.contacts where id = pair.gone_id;
    moved := moved || jsonb_build_object(
      'contacts folded', coalesce((moved ->> 'contacts folded')::integer, 0) + 1
    );
  end loop;

  -- The same posting saved at both: keep both rows, let the roles merge after.
  update job_search.roles g set jd_hash = null
  where g.company_id = p_merge and g.jd_hash is not null
    and exists (
      select 1 from job_search.roles k
      where k.company_id = p_keep and k.user_id = g.user_id and k.jd_hash = g.jd_hash
    );

  -- Everything that points at the merged company now points at the kept one.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = 'job_search.companies'::regclass and c.contype = 'f'
      and pg_catalog.array_length(c.conkey, 1) = 1
  loop
    execute pg_catalog.format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using p_keep, p_merge;
    get diagnostics n = row_count;
    if n > 0 then
      moved := moved || jsonb_build_object(fk.tbl, n);
    end if;
  end loop;

  -- Deleted before the kept row takes the merged one's board, so the
  -- one-company-per-board index never sees two rows holding it.
  delete from job_search.companies where id = p_merge;

  update job_search.companies k set
    domains = array(
      select distinct d from pg_catalog.unnest(k.domains || gone.domains) as d
      where not job_search.is_shared_host(d, k.name)
      order by d
    ),
    website = coalesce(k.website, gone.website),
    careers_url = coalesce(k.careers_url, gone.careers_url),
    linkedin_url = coalesce(k.linkedin_url, gone.linkedin_url),
    logo_url = coalesce(k.logo_url, gone.logo_url),
    industry = coalesce(k.industry, gone.industry),
    stage = coalesce(k.stage, gone.stage),
    headcount_band = coalesce(k.headcount_band, gone.headcount_band),
    hq_location = coalesce(k.hq_location, gone.hq_location),
    research = case
      when k.research is null then gone.research
      when gone.research is null or gone.research = k.research then k.research
      else k.research || E'\n\n' || gone.research
    end,
    ats_type = case when k.ats_type = 'unknown' then gone.ats_type else k.ats_type end,
    ats_board_token = case
      when k.ats_board_token is null and (k.ats_type = 'unknown' or k.ats_type = gone.ats_type)
        then gone.ats_board_token
      else k.ats_board_token
    end,
    ats_board_hint = coalesce(k.ats_board_hint, gone.ats_board_hint),
    updated_at = now()
  where k.id = p_keep;

  perform job_search.sync_company_status(p_keep);

  return jsonb_build_object(
    'kept', p_keep,
    'kept_slug', kept.slug,
    'merged_name', gone.name,
    'moved', moved
  );
end;
$$;

comment on function job_search.merge_companies(uuid, uuid) is
  'Folds p_merge into p_keep: repoints every foreign key to companies (read from the catalogue), folds same-name contacts, fills the kept row''s empty fields, deletes p_merge. Security invoker.';

revoke all on function job_search.merge_companies(uuid, uuid) from public, anon;
grant execute on function job_search.merge_companies(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
