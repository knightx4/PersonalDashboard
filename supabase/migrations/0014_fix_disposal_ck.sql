-- inventory_disposal_ck required disposed_at iff status = 'disposed'.
-- Marking sold / gifted also sets disposed_at (when the unit left ownership),
-- which violated the check. Widen it to every non-owned, non-returned status.

alter table inventory_items
  drop constraint inventory_disposal_ck;

alter table inventory_items
  add constraint inventory_disposal_ck check (
    (
      status in ('owned', 'returned')
      and disposed_at is null
    )
    or (
      status in ('disposed', 'sold', 'gifted', 'lost')
      and disposed_at is not null
    )
  );
