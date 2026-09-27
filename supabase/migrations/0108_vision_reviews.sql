-- What the weekly vision review found for each workspace (plan #1104).
--
-- Once a week a session reads what the person filed and did in each workspace
-- and says one of two things about its vision: it still holds, or here is a
-- specific edit to it, with the notes and likes that argue for it. Either way
-- the finding is one row here, one per workspace per review, so the page can
-- show the last date a vision was checked as well as any edit waiting on the
-- person.
--
-- An edit sits beside the vision rather than replacing it. `module_visions`
-- stays the person's words until they accept one, and the row keeps the
-- vision as it stood when the review read it, so what the edit changes can be
-- shown even after the vision moves on. Accepting writes the new text into
-- `module_visions` and the edit's status in one statement, through
-- `decide_vision_edit` below.
--
-- A session writes these, so the table is not a source for Goals
-- (lib/dev/sources.ts).

set search_path = public, extensions;

create table if not exists vision_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The workspace, as its module id, or 'app' for the app's own vision: the
  -- same key as module_visions.module.
  module text not null,
  -- The review this came from. Every row one weekly run writes shares it, so
  -- a run's findings read back together; the run itself has no row of its
  -- own. `session_id` is the cse_ id of the session that ran it, when known.
  review_id uuid not null,
  session_id text,
  -- 'holds': the vision still describes the workspace. 'edit': it does not,
  -- and `proposed_body` says what it should say instead.
  outcome text not null,
  -- The vision as the review read it. Null when the workspace had none, which
  -- is the case an edit drafts one for.
  vision_body text,
  proposed_body text,
  -- Why: for 'holds' the dated note itself, for 'edit' the argument the
  -- evidence makes.
  note text not null,
  -- The feedback_items rows (notes and likes) that argue for the edit. An
  -- array, since there is nothing to join on but the ids; the loader reads the
  -- rows back and drops any that have since been deleted.
  evidence_ids uuid[] not null default '{}',
  -- An edit is pending until the person accepts or dismisses it. A 'holds'
  -- row asks nothing of them and has no status.
  status text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vision_reviews_module_not_blank_ck check (length(btrim(module)) > 0),
  constraint vision_reviews_outcome_ck check (outcome in ('holds', 'edit')),
  constraint vision_reviews_status_ck check (status in ('pending', 'accepted', 'dismissed')),
  constraint vision_reviews_note_not_blank_ck check (length(btrim(note)) > 0),
  constraint vision_reviews_proposed_length_ck check (length(proposed_body) <= 8000),
  -- The shape each outcome takes: an edit carries its text and a status, and
  -- a 'holds' carries neither.
  constraint vision_reviews_outcome_shape_ck check (
    case outcome
      when 'edit' then proposed_body is not null
        and length(btrim(proposed_body)) > 0
        and status is not null
      else proposed_body is null and status is null and cardinality(evidence_ids) = 0
    end
  ),
  constraint vision_reviews_decided_ck check ((status in ('accepted', 'dismissed')) = (decided_at is not null))
);

-- The latest finding per workspace, which is what the specs page reads.
create index if not exists vision_reviews_user_module_idx
  on vision_reviews (user_id, module, created_at desc);

-- One edit waiting per workspace. A review that finds another reason to
-- change a vision with an edit still pending dismisses or folds into that
-- one, rather than stacking a second beside it.
create unique index if not exists vision_reviews_one_pending_uq
  on vision_reviews (user_id, module) where status = 'pending';

drop trigger if exists vision_reviews_touch_updated_at on vision_reviews;
create trigger vision_reviews_touch_updated_at
  before update on vision_reviews
  for each row execute function public.touch_updated_at();

alter table vision_reviews enable row level security;

drop policy if exists vision_reviews_select on vision_reviews;
create policy vision_reviews_select on vision_reviews for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists vision_reviews_insert on vision_reviews;
create policy vision_reviews_insert on vision_reviews for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists vision_reviews_update on vision_reviews;
create policy vision_reviews_update on vision_reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists vision_reviews_delete on vision_reviews;
create policy vision_reviews_delete on vision_reviews for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on vision_reviews to authenticated;
revoke all on table vision_reviews from anon;

-- Accept or dismiss a pending edit. Accepting writes the proposed text as the
-- workspace's vision and marks the edit accepted in the same transaction, so
-- the page never shows a vision that changed under an edit still pending, or
-- the reverse. Runs as the caller: RLS decides whose edit it may touch, and
-- a row it cannot see reads as not found.
create or replace function decide_vision_edit(p_edit uuid, p_accept boolean)
returns vision_reviews
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  edit vision_reviews;
begin
  update vision_reviews
  set status = case when p_accept then 'accepted' else 'dismissed' end,
      decided_at = now()
  where id = p_edit and outcome = 'edit' and status = 'pending'
  returning * into edit;

  if not found then
    raise exception 'No pending vision edit %', p_edit using errcode = 'P0002';
  end if;

  if p_accept then
    insert into module_visions (user_id, module, body)
    values (edit.user_id, edit.module, edit.proposed_body)
    on conflict (user_id, module) do update set body = excluded.body;
  end if;

  return edit;
end;
$$;

revoke all on function decide_vision_edit(uuid, boolean) from public, anon;
grant execute on function decide_vision_edit(uuid, boolean) to authenticated, service_role;
