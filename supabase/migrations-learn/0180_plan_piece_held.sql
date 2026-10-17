-- A piece a placement showed you already hold (plan #2292.5).
--
--   plan_pieces.held_at, plan_pieces.held_reason
--       When and why a piece was found already held. 'placement' when a
--       placement run, before the first lesson, showed every cell the piece
--       teaches as held. A held piece is not passed: it still opens, its
--       lessons read folded to their takeaways, and its check asks the level
--       above. Passing that check passes it as any piece passes.
--
-- A placement no longer passes a piece, so passed_reason is only ever 'check'
-- from here on. No piece was passed by placement before this file, so no row
-- is rewritten.

set search_path = learn, public, extensions;

alter table learn.plan_pieces add column if not exists held_at timestamptz;
alter table learn.plan_pieces add column if not exists held_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'plan_pieces_held_reason_ck' and conrelid = 'learn.plan_pieces'::regclass
  ) then
    alter table learn.plan_pieces
      add constraint plan_pieces_held_reason_ck
        check (
          (held_at is null and held_reason is null)
          or (held_at is not null and held_reason in ('placement'))
        );
  end if;
end $$;

comment on column learn.plan_pieces.held_at is
  'When a placement showed every cell the piece teaches as held (plan #2292.5). Null when not held. A held piece is not passed.';
comment on column learn.plan_pieces.held_reason is
  'Why the piece is held: placement. Null when not held.';
comment on column learn.plan_pieces.passed_reason is
  'Why the piece was passed: check (its own check). Placement holds a piece rather than passing it since plan #2292.5. Null when not passed, or passed before plan #2292.2.';
