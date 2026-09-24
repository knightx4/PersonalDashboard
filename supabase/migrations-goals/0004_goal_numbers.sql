-- ===========================================================================
-- Goals measured by a number (plan #930).
--
-- A goal such as paying off a debt or lifting a heavier bench has a number
-- that moves. The goal names the unit it is measured in ("$", "lb") and,
-- when there is one, the value it is aiming for. Each time you give the
-- number it is a new row in goals.readings (0001), dated, so the series is
-- the record and no earlier value is overwritten.
--
-- A target without a unit is refused: a number with nothing to say what it
-- counts reads the same as a typo. Only goals carry either; a step's progress
-- is its status or its rhythm.
-- ===========================================================================

alter table goals.items
  add column unit text,
  add column target numeric;

alter table goals.items
  add constraint items_unit_ck check (
    unit is null or (level = 'goal' and btrim(unit) <> '' and length(unit) <= 40)
  ),
  add constraint items_target_ck check (target is null or unit is not null);

-- A reading is written once. Its value, its date and the goal it belongs to
-- cannot be changed afterwards; one entered by mistake is deleted, which the
-- history trigger keeps, and the right value is entered as a new reading.
-- The note and the capture link may still change (the capture link is set to
-- null by its foreign key when a capture is removed).
create or replace function goals.readings_keep_value()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.value is distinct from old.value
     or new.read_on is distinct from old.read_on
     or new.item_id is distinct from old.item_id then
    raise exception 'readings: a reading is never overwritten; add a new one'
      using errcode = 'check_violation', constraint = 'readings_keep_value';
  end if;
  return new;
end;
$$;

create trigger readings_keep_value before update on goals.readings
  for each row execute function goals.readings_keep_value();
