-- The two functions an anonymous visitor may call, and the only two.
--
-- Same posture as job_search.public_case_page (migrations-job-search/0017),
-- for the same reasons, which are worth restating because this pair goes
-- further than that one did:
--
--   * Not a service-role client in a route handler. That bypasses RLS
--     entirely and makes the route the only thing between a typo and every
--     row in the database.
--   * Not an anon policy on inventory_items. A policy admitting anon when a
--     token matches is inherited by every future query on that table, and the
--     next person to add a join gets the exemption for free.
--   * Not a view. A view cannot take the token as an argument, so the
--     authorization check would live in the caller.
--
-- `security definer` because the caller genuinely has no session and so no
-- auth.uid() to check a policy against. It is safe because each function *is*
-- the whole authorization decision, both are visible here in full, neither
-- accepts a user id, and neither exposes a table.
--
-- 0007_lock_down_definer_functions revokes anon and authenticated from the
-- definer helpers because they were never meant to be reachable over
-- PostgREST. These two are the exception that proves the rule: being called
-- by anon is their entire purpose.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Read
-- ---------------------------------------------------------------------------
--
-- Declared `stable`, not `volatile`, and that is load-bearing rather than
-- decorative: a stable function cannot write, so "opening the link does
-- nothing" is enforced by the function's own volatility class and not only by
-- the discipline of whoever edits it next. There is no pg_net, no http, and no
-- pg_cron call in here, and there is no path by which one could be added
-- without changing this declaration in the diff.
--
-- The consequence, accepted deliberately: nothing records that she opened the
-- page. `last_seen_at` is touched by share_respond() below, so the owner
-- learns she was here when she answers, not when she looks. A read that
-- writes is a read that can be made to write something else.
--
-- What comes back is a projection, not a join. Cost, merchant, acquisition
-- date, private notes, category and user_id are not in the object below, so
-- they were never sent -- an assertion tests/rls-share.test.ts makes against
-- the returned keys, so a later `select *` cannot widen it quietly.
create or replace function public.share_page(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tok as (
    select t.id as token_id, t.share_link_id, t.can_respond
      from public.share_link_tokens t
      join public.share_links s on s.id = t.share_link_id
     where t.token = p_token
       and p_token is not null
       -- The same floor the token's own check constraint sets, so a truncated
       -- token can never collide with a legitimately short one.
       and length(p_token) >= 24
       and t.revoked_at is null
       and (t.expires_at is null or t.expires_at > now())
       and s.status = 'active'
     limit 1
  ),
  sh as (
    select s.id, s.user_id, s.title, s.intro, s.kind,
           tok.can_respond, tok.token_id
      from tok
      join public.share_links s on s.id = tok.share_link_id
  ),
  -- One row per real unit. The join to inventory_items is scoped to the
  -- share owner's rows, so a share can only ever surface its owner's things
  -- even if a stray subject_id were written into it.
  units as (
    select sli.group_key,
           sli.family_key,
           sli.position,
           i.id as item_id,
           coalesce(nullif(btrim(i.short_name), ''), i.name) as display_name,
           i.image_url,
           gd.bgg_id,
           gd.manual_expected_price_cents,
           case fam.role
             when 'base' then 0 when 'edition' then 1 when 'expansion' then 2
             when 'accessory' then 3 when 'member' then 4 else 5
           end as role_rank
      from sh
      join public.share_link_items sli on sli.share_link_id = sh.id
      join public.inventory_items i
        on i.id = sli.subject_id and i.user_id = sh.user_id
      left join public.game_details gd on gd.inventory_item_id = i.id
      left join public.inventory_item_families fam
        on fam.inventory_item_id = i.id and fam.confirmed_at is not null
     where sli.subject_type = 'inventory_item'
  ),
  -- Cached prices only. Never a lookup, never a refresh, never an outbound
  -- call: see "The link is a window, never an engine" in the spec. A manual
  -- price wins because a price you typed yourself beats every estimate; after
  -- that it is the freshest cached quote, and after that it is null. Null
  -- renders as nothing at all, never as zero.
  priced as (
    select u.item_id,
           coalesce(
             u.manual_expected_price_cents,
             (select q.quoted_cents
                from public.game_price_quotes q
               where q.bgg_id = u.bgg_id
                 and q.quoted_cents is not null
               order by q.fetched_at desc
               limit 1)
           ) as unit_price_cents
      from units u
  ),
  grouped as (
    select u.group_key,
           u.family_key,
           count(*)::int as quantity,
           -- Identical units by definition, so any name does; min() makes the
           -- choice deterministic rather than dependent on scan order.
           min(u.display_name) as name,
           (array_agg(u.image_url) filter (where u.image_url is not null))[1]
             as image_url,
           -- max() ignores nulls, so one priced unit prices the group.
           max(p.unit_price_cents) as unit_price_cents,
           min(u.position) as position,
           min(u.role_rank) as role_rank
      from units u
      join priced p on p.item_id = u.item_id
     group by u.group_key, u.family_key
  ),
  rendered as (
    select coalesce(f.name, g.family_key) as family_label,
           g.family_key,
           g.role_rank,
           g.name,
           jsonb_build_object(
             'groupKey', g.group_key,
             'familyKey', g.family_key,
             'familyLabel', coalesce(f.name, g.family_key),
             'name', g.name,
             'quantity', g.quantity,
             'imageUrl', g.image_url,
             'unitPriceCents', g.unit_price_cents,
             'keepQty', coalesce(r.keep_qty, 0),
             'sellQty', coalesce(r.sell_qty, 0),
             'giveawayQty', coalesce(r.giveaway_qty, 0),
             'note', r.note,
             'answeredAt', r.updated_at
           ) as obj
      from grouped g
      cross join sh
      left join public.item_families f
        on f.user_id = sh.user_id and f.slug = g.family_key
      left join public.share_link_responses r
        on r.share_link_id = sh.id and r.group_key = g.group_key
  )
  select jsonb_build_object(
    'title', sh.title,
    'intro', sh.intro,
    'kind', sh.kind,
    'canRespond', sh.can_respond,
    'groups', coalesce(
      (select jsonb_agg(x.obj order by
                 -- Families first and together, ungrouped items after them.
                 x.family_label nulls last, x.role_rank, x.name)
         from rendered x),
      '[]'::jsonb)
  )
  from sh;
$$;

-- ---------------------------------------------------------------------------
-- Write
-- ---------------------------------------------------------------------------
--
-- The case page never needed this; a form does. Everything the function is
-- allowed to change is three integers, a capped note, one event row and a
-- last_seen_at, all inside the database and all scoped to the one share the
-- token names.
--
-- Refusals come back as `{ok: false, error: ...}` rather than as raised
-- exceptions, because the caller is a form that has to say *why* a number
-- would not take, and parsing that out of an error string is how a UI ends up
-- showing "unexpected error" to someone who typed a 4 into a field with a
-- maximum of 3. The one exception is a bad token, which returns null, so a
-- wrong token and a revoked one are indistinguishable -- the same reason the
-- read function has one failure mode.
create or replace function public.share_respond(
  p_token text,
  p_group_key text,
  p_keep integer,
  p_sell integer,
  p_giveaway integer,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_token_id uuid;
  v_share_id uuid;
  v_can_respond boolean;
  v_quantity integer;
  v_recent integer;
  v_note text;
  v_row public.share_link_responses;
begin
  -- 1. Resolve the token. Same conditions as share_page(), so a link that
  --    cannot be read cannot be written either.
  select t.id, t.share_link_id, t.can_respond
    into v_token_id, v_share_id, v_can_respond
    from public.share_link_tokens t
    join public.share_links s on s.id = t.share_link_id
   where t.token = p_token
     and p_token is not null
     and length(p_token) >= 24
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > now())
     and s.status = 'active'
   limit 1;

  if v_token_id is null then
    return null;
  end if;

  if not v_can_respond then
    return jsonb_build_object('ok', false, 'error', 'read_only');
  end if;

  -- 2. Rate limit, counted off the append-only event log. Unguessability is
  --    what stops strangers; this is what keeps a stuck client or a bored
  --    houseguest bounded, and visible afterwards.
  select count(*)::int into v_recent
    from public.share_link_events e
   where e.token_id = v_token_id
     and e.created_at > now() - interval '1 minute';

  if v_recent >= 60 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  -- 3. The quantity is counted here, never taken from the caller. Zero means
  --    the group is not on this share, so an invented group key is refused
  --    rather than silently creating a response nobody can see.
  select count(*)::int into v_quantity
    from public.share_link_items sli
    join public.inventory_items i on i.id = sli.subject_id
   where sli.share_link_id = v_share_id
     and sli.group_key = p_group_key
     and sli.subject_type = 'inventory_item';

  if v_quantity = 0 then
    return jsonb_build_object('ok', false, 'error', 'unknown_group');
  end if;

  -- 4. Clamp. Over the quantity is an error rather than a silent truncation:
  --    she should see why the number would not take.
  if coalesce(p_keep, 0) < 0 or coalesce(p_sell, 0) < 0 or coalesce(p_giveaway, 0) < 0 then
    return jsonb_build_object('ok', false, 'error', 'negative');
  end if;

  if coalesce(p_keep, 0) + coalesce(p_sell, 0) + coalesce(p_giveaway, 0) > v_quantity then
    return jsonb_build_object(
      'ok', false, 'error', 'over_quantity', 'quantity', v_quantity);
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null then
    v_note := left(v_note, 500);
  end if;

  -- 5. Upsert, log, and mark the token seen.
  insert into public.share_link_responses as r (
    share_link_id, group_key, keep_qty, sell_qty, giveaway_qty, note,
    answered_by_token
  )
  values (
    v_share_id, p_group_key, coalesce(p_keep, 0), coalesce(p_sell, 0),
    coalesce(p_giveaway, 0), v_note, v_token_id
  )
  on conflict (share_link_id, group_key) do update
     set keep_qty = excluded.keep_qty,
         sell_qty = excluded.sell_qty,
         giveaway_qty = excluded.giveaway_qty,
         note = excluded.note,
         answered_by_token = excluded.answered_by_token
  returning * into v_row;

  insert into public.share_link_events (
    share_link_id, token_id, kind, group_key, payload
  )
  values (
    v_share_id, v_token_id, 'responded', p_group_key,
    jsonb_build_object(
      'keep', v_row.keep_qty, 'sell', v_row.sell_qty,
      'giveaway', v_row.giveaway_qty, 'quantity', v_quantity,
      'hasNote', v_row.note is not null)
  );

  update public.share_link_tokens
     set last_seen_at = now()
   where id = v_token_id;

  return jsonb_build_object(
    'ok', true,
    'group', jsonb_build_object(
      'groupKey', v_row.group_key,
      'quantity', v_quantity,
      'keepQty', v_row.keep_qty,
      'sellQty', v_row.sell_qty,
      'giveawayQty', v_row.giveaway_qty,
      'undecided', v_quantity - v_row.keep_qty - v_row.sell_qty - v_row.giveaway_qty,
      'note', v_row.note,
      'answeredAt', v_row.updated_at
    )
  );
end;
$$;

revoke all on function public.share_page(text) from public;
revoke all on function public.share_respond(text, text, integer, integer, integer, text)
  from public;

grant execute on function public.share_page(text) to anon, authenticated;
grant execute on function public.share_respond(text, text, integer, integer, integer, text)
  to anon, authenticated;
