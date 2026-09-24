-- ===========================================================================
-- Information steps: a step that points at a collection, and records that
-- wait as drafts until you confirm them (plan #954).
--
-- docs/GOALS-SPEC.md, "Information steps and collections". A step such as
-- "List your loan balances, rates and minimum payments" now names the
-- collection it fills, and the goal page draws its form or table from that
-- collection's definition (0009).
--
--   items.collection_id  the collection an information step fills. Only a
--                        step has one.
--   items.asks_for       the field keys the step needs filled in every
--                        record. Null means every field the form shows.
--   records.draft        true while a record is something found for you
--                        (in Gmail, a document or a paste) that you have not
--                        yet confirmed. A record you type is never a draft.
--
-- Confirming is yours: a write that says it is Claude's adds a record only as
-- a draft and may not confirm one, as it may not answer a question (0006) or
-- mark a result read (0007).
--
-- When the step closes is worked out by the app, in lib/goals/information.ts:
-- a one-record collection closes its step on the save that completes it, and
-- a list closes it when you say the list is whole.
-- ===========================================================================

alter table goals.items
  add column collection_id uuid,
  add column asks_for text[];

alter table goals.items
  -- No action: a collection a step points at cannot be hard-deleted.
  add constraint items_collection_fk foreign key (collection_id, user_id)
    references goals.collections (id, user_id),
  add constraint items_collection_step_ck check (collection_id is null or level = 'step'),
  add constraint items_asks_for_ck check (
    asks_for is null
    or (collection_id is not null and cardinality(asks_for) between 1 and 60)
  );

create index items_collection_idx on goals.items (collection_id)
  where collection_id is not null;

alter table goals.records
  add column draft boolean not null default false;

alter table goals.records
  add constraint records_draft_source_ck check (not draft or source <> 'typed');

create or replace function goals.records_draft_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if tg_op = 'INSERT' and not new.draft then
    raise exception 'Claude adds a record only as a draft, for you to confirm.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and old.draft and not new.draft then
    raise exception 'Claude may not confirm a draft: only you do that.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.records_draft_guard() from public, anon, authenticated;

create trigger records_draft_guard before insert or update on goals.records
  for each row execute function goals.records_draft_guard();
