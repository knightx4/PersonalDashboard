-- How sure the person was, how they reasoned, and how many hints they needed.
--
-- confidence is 0 to 1, null when the person did not give one. reasoning is
-- what they wrote about why. hints_used counts hints shown before the answer;
-- miss_kind names the kind of miss once one is judged. Columns only: no
-- existing row is changed, and the sources catalogue is unchanged.

alter table learn.probes
  add column if not exists confidence numeric,
  add column if not exists reasoning text,
  add column if not exists hints_used smallint not null default 0,
  add column if not exists miss_kind text;

alter table learn.cell_questions
  add column if not exists confidence numeric,
  add column if not exists reasoning text,
  add column if not exists hints_used smallint not null default 0,
  add column if not exists miss_kind text;

alter table learn.piece_checks
  add column if not exists confidence numeric,
  add column if not exists reasoning text,
  add column if not exists hints_used smallint not null default 0,
  add column if not exists miss_kind text;

alter table learn.review_questions
  add column if not exists confidence numeric,
  add column if not exists reasoning text,
  add column if not exists hints_used smallint not null default 0,
  add column if not exists miss_kind text;

do $$
declare t text;
begin
  foreach t in array array['probes', 'cell_questions', 'piece_checks', 'review_questions'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_confidence_range'
                   and conrelid = ('learn.' || t)::regclass) then
      execute format('alter table learn.%I add constraint %I check (confidence is null or (confidence >= 0 and confidence <= 1))',
                     t, t || '_confidence_range');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_hints_used_range'
                   and conrelid = ('learn.' || t)::regclass) then
      execute format('alter table learn.%I add constraint %I check (hints_used >= 0)',
                     t, t || '_hints_used_range');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_miss_kind_values'
                   and conrelid = ('learn.' || t)::regclass) then
      execute format('alter table learn.%I add constraint %I check (miss_kind is null or miss_kind in (''cue'', ''wrong_idea'', ''slip'', ''careless'', ''misconception''))',
                     t, t || '_miss_kind_values');
    end if;
  end loop;
end $$;

comment on column learn.probes.confidence is
  'How sure the person said they were, 0 to 1; null when not given.';
comment on column learn.probes.miss_kind is
  'Kind of miss: cue, wrong_idea, slip, careless or misconception; null when not a miss or not judged.';
