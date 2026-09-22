-- A note in a folder the person left out of the map (lib/vault/map/rules.ts,
-- EXCLUDED_FOLDERS) is recorded as `excluded`, beside `journal`: turned away
-- before anything is sent, and counted on the sweep panel under its own line.

set search_path = obsidian, public, extensions;

alter table obsidian.map_sweep_notes drop constraint map_sweep_notes_outcome_ck;
alter table obsidian.map_sweep_notes add constraint map_sweep_notes_outcome_ck check (outcome in (
  'reading', 'read', 'unchanged', 'journal', 'excluded', 'credential', 'too_short',
  'record', 'nothing', 'failed'
));
