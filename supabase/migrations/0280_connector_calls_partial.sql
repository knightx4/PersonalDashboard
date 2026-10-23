-- A connector call that answered with part of what it was asked for
-- (core.connector_calls, migration 0133 and after).
--
-- `search` over the connector read none of the person's workspaces for weeks:
-- every source failed and the answer said "Could not read: Job search,
-- Shopping, …" inside a result that was otherwise fine. The log kept it as
-- outcome 'ok' with no error, so nothing that reads the log could see it.
-- 'partial' is an answer that also says what it could not read: it keeps its
-- reads, as 'ok' does, and its error, as 'error' does.
--
-- Schema only: no rows are changed.

set search_path = core, public, extensions;

alter table core.connector_calls drop constraint connector_calls_outcome_ck;
alter table core.connector_calls drop constraint connector_calls_error_ck;

alter table core.connector_calls
  add constraint connector_calls_outcome_ck check (outcome in ('ok', 'partial', 'error', 'limited')),
  add constraint connector_calls_error_ck check (
    case outcome
      when 'ok' then error is null
      when 'partial' then error is not null
      else error is not null and reads = '[]'::jsonb
    end
  );

comment on column core.connector_calls.outcome is
  'ok: answered. partial: answered, but could not read some of what it was asked for (error says what). error: refused. limited: refused by the rate cap.';
