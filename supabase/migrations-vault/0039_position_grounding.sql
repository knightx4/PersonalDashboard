-- A position is marked no longer grounded the moment its last live quote goes
-- (plan #2446.1, under #2446).
--
-- positions.ungrounded_at (0002) was meant to be set when every quote
-- supporting a position has left the record, and nothing set it: a note that
-- was soft-deleted, or a quote row that was removed, left the position on the
-- map looking as grounded as one with three quotes behind it. The map and
-- retrieval (0003, 0036) already leave out a position with the column set.
--
-- A quote is live when its note has deleted_at null. The triggers below keep
-- the column true to that after every change that can move it:
--
--   position_sources  insert, delete, and an update that moves a quote to
--                     another position or note (a merge, an undo)
--   notes             deleted_at set or cleared
--
-- Setting the mark keeps the first time it was set; clearing it happens as
-- soon as one live quote is back. A position is never deleted here, because
-- the writer may well still hold it. The clear in accept_note_map (0003) and
-- the snapshot restore in the merge undo (0009, 0020) are left as they are:
-- the undo moves quotes back after restoring, and the triggers then settle
-- each side by what is actually there.
--
-- Row triggers rather than statement triggers with transition tables: a
-- statement trigger on notes would copy every changed note's body into the
-- transition table on each sync, and the notes trigger here fires only when
-- deleted_at itself changes.

set search_path = obsidian, public, extensions;

-- Settle the mark on the given positions from their quotes as they stand.
-- Writes only rows whose mark is wrong, so a no-op change does not move
-- updated_at.
create or replace function obsidian.settle_position_grounding(p_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  update obsidian.positions p
     set ungrounded_at = case when g.grounded then null else now() end
    from (
      select q.id,
             exists (
               select 1
                 from obsidian.position_sources s
                 join obsidian.notes n on n.id = s.note_id
                where s.position_id = q.id
                  and n.deleted_at is null
             ) as grounded
        from obsidian.positions q
       where q.id = any (p_ids)
    ) g
   where p.id = g.id
     and (g.grounded) = (p.ungrounded_at is not null);
$$;

comment on function obsidian.settle_position_grounding(uuid[]) is
  'Sets positions.ungrounded_at when none of the position''s quotes is on a live note, and clears it when one is (plan #2446.1).';

create or replace function obsidian.position_sources_settle_grounding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform obsidian.settle_position_grounding(array[new.position_id]);
  elsif tg_op = 'DELETE' then
    perform obsidian.settle_position_grounding(array[old.position_id]);
  else
    perform obsidian.settle_position_grounding(array[old.position_id, new.position_id]);
  end if;
  return null;
end;
$$;

create trigger position_sources_settle_grounding
  after insert or delete or update of position_id, note_id on obsidian.position_sources
  for each row execute function obsidian.position_sources_settle_grounding();

create or replace function obsidian.notes_settle_grounding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform obsidian.settle_position_grounding(
    array(select distinct s.position_id from obsidian.position_sources s where s.note_id = new.id)
  );
  return null;
end;
$$;

create trigger notes_settle_grounding
  after update of deleted_at on obsidian.notes
  for each row
  when (old.deleted_at is distinct from new.deleted_at)
  execute function obsidian.notes_settle_grounding();

-- The two trigger functions are security definer so that the call to
-- settle_position_grounding runs as its owner: a trigger function's EXECUTE is
-- checked when the trigger is created, but a function it calls is checked when
-- it fires, as whoever made the change. Each one only reaches the positions
-- the changed row points at, which the composite foreign keys hold to the
-- row's own user. None of the three is on the PostgREST RPC surface.
revoke all on function obsidian.settle_position_grounding(uuid[]) from public, anon, authenticated;
revoke all on function obsidian.position_sources_settle_grounding() from public, anon, authenticated;
revoke all on function obsidian.notes_settle_grounding() from public, anon, authenticated;
