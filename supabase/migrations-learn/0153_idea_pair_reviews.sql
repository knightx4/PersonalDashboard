-- The same idea in two subjects, found once and settled once (plan #2147.2).
--
-- Idea Space already lists pairs of ideas whose vectors are 0.86 or more
-- alike, and merges nothing. Some of those pairs are one idea written twice,
-- once in each of two subjects ("MRR is a run-rate, not cash collected" in
-- SaaS metrics and in Startup Finance). This migration gives the person a way
-- to settle each such pair: merge the two into one idea, or keep both.
--
-- Closeness only finds a pair. Nothing here acts on similarity alone: both
-- functions that change anything run when the person presses a button on the
-- pair, and the pair function only lists.
--
-- Here, one table and two functions; 0154 adds the third:
--
--   learn.idea_pair_reviews         what was decided, so a settled pair is
--                                   never listed again, with a copy of what a
--                                   merge removed.
--   learn.cross_subject_idea_pairs  the pairs still to settle, closest first.
--   learn.keep_both_ideas           both stay; a tested result is carried to
--                                   the other as inferred.
--   learn.merge_ideas (0154)        one idea keeps the other's answers.

set search_path = learn, public, extensions;

create table if not exists learn.idea_pair_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The pair, the lower id first so it has one spelling. Plain ids rather
  -- than foreign keys: after a merge one of the two no longer exists, and the
  -- row has to outlive it.
  concept_low uuid not null,
  concept_high uuid not null,
  similarity double precision not null,

  decision text not null,
  -- On a merge, the idea that stayed. On keep-both, null.
  kept_id uuid,
  -- On keep-both, the idea that took the other's tested result as inferred,
  -- or null when neither side had one to carry or the other already had a
  -- state of its own.
  carried_to uuid,
  -- On a merge, the removed idea as it was: its row (without the vector), its
  -- state row, and its prerequisite links, which cannot follow it into
  -- another subject. Enough to write it back by hand.
  retired jsonb,

  created_at timestamptz not null default now(),

  constraint idea_pair_reviews_order_ck check (concept_low < concept_high),
  constraint idea_pair_reviews_decision_ck check (decision in ('merged', 'kept')),
  constraint idea_pair_reviews_merge_ck check (
    (decision = 'merged' and kept_id is not null and retired is not null)
    or (decision = 'kept' and kept_id is null and retired is null)
  ),
  constraint idea_pair_reviews_pair_uq unique (user_id, concept_low, concept_high)
);

alter table learn.idea_pair_reviews enable row level security;

create policy idea_pair_reviews_select on learn.idea_pair_reviews for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert, update or delete policy: rows are written only by
-- keep_both_ideas below and merge_ideas in 0154, which check the ideas are the caller's own.

grant select on learn.idea_pair_reviews to authenticated;
revoke all on table learn.idea_pair_reviews from anon;

-- ---------------------------------------------------------------------------
-- The pairs still to settle.
--
-- Two of the caller's ideas whose vectors, from the same model, are at least
-- `min_similarity` alike, filed under different home subjects, and not
-- settled before. Each pair once, the lower id as `a`.

create or replace function learn.cross_subject_idea_pairs(min_similarity double precision)
returns table (a_id uuid, b_id uuid, similarity double precision)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  select a.id, b.id, (1 - (a.embedding <=> b.embedding))::double precision
    from learn.concepts a
    join learn.concepts b
      on b.user_id = a.user_id
     and b.id > a.id
     and b.subject_id <> a.subject_id
     and b.embedding_model is not distinct from a.embedding_model
   where a.user_id = (select auth.uid())
     and a.embedding is not null
     and b.embedding is not null
     and 1 - (a.embedding <=> b.embedding) >= min_similarity
     and not exists (
       select 1 from learn.idea_pair_reviews r
        where r.user_id = a.user_id and r.concept_low = a.id and r.concept_high = b.id
     )
   order by 3 desc, a.id, b.id
$$;

comment on function learn.cross_subject_idea_pairs(double precision) is
  'The caller''s near-identical ideas in different subjects not yet merged or kept, closest first.';

revoke all on function learn.cross_subject_idea_pairs(double precision) from public, anon;
grant execute on function learn.cross_subject_idea_pairs(double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep both: the pair is two ideas after all, or one the person wants in both
-- places. A tested result on one is carried to the other as `inferred`, the
-- state a result reached through another idea already has, and only onto an
-- idea with no state of its own: an inference never overwrites evidence.
-- Only a result that holds the idea carries; a wrong answer about one says
-- nothing reliable about the other.

create or replace function learn.keep_both_ideas(p_a uuid, p_b uuid, p_similarity double precision)
returns uuid
language plpgsql
security definer
set search_path = learn, public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_a_state learn.concept_state%rowtype;
  v_b_state learn.concept_state%rowtype;
  v_from learn.concept_state%rowtype;
  v_to uuid;
  v_carried uuid;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_a = p_b
     or (select count(*) from learn.concepts where user_id = v_user and id in (p_a, p_b)) <> 2 then
    raise exception 'Idea not found' using errcode = 'P0002';
  end if;

  select * into v_a_state from learn.concept_state where concept_id = p_a and user_id = v_user;
  select * into v_b_state from learn.concept_state where concept_id = p_b and user_id = v_user;

  if v_a_state.established = 'tested' and v_a_state.state in ('recognised', 'known', 'sharp')
     and v_b_state.concept_id is null then
    v_from := v_a_state; v_to := p_b;
  elsif v_b_state.established = 'tested' and v_b_state.state in ('recognised', 'known', 'sharp')
     and v_a_state.concept_id is null then
    v_from := v_b_state; v_to := p_a;
  end if;

  if v_to is not null then
    insert into learn.concept_state (concept_id, user_id, state, established, misconception)
    values (v_to, v_user, v_from.state, 'inferred', null)
    on conflict (concept_id) do nothing
    returning concept_id into v_carried;
  end if;

  insert into learn.idea_pair_reviews (user_id, concept_low, concept_high, similarity, decision, carried_to)
  values (v_user, least(p_a, p_b), greatest(p_a, p_b), p_similarity, 'kept', v_carried)
  on conflict (user_id, concept_low, concept_high) do update
    set decision = 'kept', kept_id = null, retired = null, carried_to = excluded.carried_to,
        similarity = excluded.similarity, created_at = now();

  return v_carried;
end;
$$;

comment on function learn.keep_both_ideas(uuid, uuid, double precision) is
  'Keep two of the caller''s near-identical ideas apart, carrying a tested result across as inferred.';

revoke all on function learn.keep_both_ideas(uuid, uuid, double precision) from public, anon;
grant execute on function learn.keep_both_ideas(uuid, uuid, double precision) to authenticated;
