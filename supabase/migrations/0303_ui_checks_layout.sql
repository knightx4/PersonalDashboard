-- Whether a screen's layout matches its reference (plan #2966.5).
--
-- On a surface with a reference design registered, every critic round also
-- answers whether the layout (the panes, where the list and the content sit,
-- what each row holds) matches the reference. The answer is kept whole as
-- `{"answer": "...", "ok": true|false}`. A round whose `ok` is false fails
-- whatever the laws say, and the close guard (lib/plan/ui-check-guard.ts)
-- refuses the step until a later round on that surface answers yes.
--
-- Null means the question was not asked: no reference, or a round recorded
-- before this. No existing row is touched.

set search_path = public, extensions;

alter table ui_checks add column if not exists layout jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ui_checks_layout_ck') then
    alter table ui_checks
      add constraint ui_checks_layout_ck
      check (layout is null or (jsonb_typeof(layout) = 'object' and jsonb_typeof(layout->'ok') = 'boolean'));
  end if;
end $$;
