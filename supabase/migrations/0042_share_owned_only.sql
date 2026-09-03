-- The form only ever asks about things still owned.
--
-- 0041 joined inventory_items without looking at status, which was fine while
-- nothing acted on her answers. Applying a decision changes status -- 'sold',
-- 'gifted' -- and without this the box would stay on the form afterwards,
-- asking her again about something already gone, and the quantity she is
-- answering against would no longer be the quantity that exists.
--
-- It also covers the case that has nothing to do with sharing: an item
-- returned, lost, or disposed of from the inventory page drops off the form on
-- its own, rather than lingering until someone remembers to take it off.
--
-- The filter goes in BOTH functions. share_page() showing three and
-- share_respond() counting four is the kind of disagreement that surfaces as
-- "it says there are only 3 of these" on a form that plainly lists 4.

set search_path = public, extensions;

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
        on i.id = sli.subject_id
       and i.user_id = sh.user_id
       and i.status = 'owned'
      left join public.game_details gd on gd.inventory_item_id = i.id
      left join public.inventory_item_families fam
        on fam.inventory_item_id = i.id and fam.confirmed_at is not null
     where sli.subject_type = 'inventory_item'
  ),
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
           min(u.display_name) as name,
           (array_agg(u.image_url) filter (where u.image_url is not null))[1]
             as image_url,
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
             -- Clamped to what is actually here. An answer of "sell 2" left
             -- over from before one of them was sold must not render as "sell
             -- 2" against a quantity of 1.
             'keepQty', least(coalesce(r.keep_qty, 0), g.quantity),
             'sellQty', least(coalesce(r.sell_qty, 0), g.quantity),
             'giveawayQty', least(coalesce(r.giveaway_qty, 0), g.quantity),
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
                 x.family_label nulls last, x.role_rank, x.name)
         from rendered x),
      '[]'::jsonb)
  )
  from sh;
$$;

-- Same filter, same reason. Only the quantity clause changes.
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

  select count(*)::int into v_recent
    from public.share_link_events e
   where e.token_id = v_token_id
     and e.created_at > now() - interval '1 minute';

  if v_recent >= 60 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select count(*)::int into v_quantity
    from public.share_link_items sli
    join public.inventory_items i on i.id = sli.subject_id
   where sli.share_link_id = v_share_id
     and sli.group_key = p_group_key
     and sli.subject_type = 'inventory_item'
     and i.status = 'owned';

  if v_quantity = 0 then
    return jsonb_build_object('ok', false, 'error', 'unknown_group');
  end if;

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

-- Applying a decision is the owner's, and it is the only thing that reads a
-- share's answers in order to change inventory. The assignment of "sell 2" to
-- two specific boxes is by id, deliberately: they are identical units, so any
-- two will do, and a deterministic choice is one that can be repeated and
-- explained.
create index if not exists share_link_items_group_subject_idx
  on share_link_items (share_link_id, group_key, subject_id);
