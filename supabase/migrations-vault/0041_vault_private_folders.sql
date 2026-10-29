-- Which folders of a vault are never sent to a model, set per connection.
--
-- Until now the folders were constants in lib/vault/map/rules.ts: `Me` as the
-- journal folder and `Career/Job Applications` as left out, which is one
-- person's layout. Anyone else's journals would not be in `Me/` and would be
-- read. Each connection now carries its own two lists, which whyNotRead
-- applies before any note goes to a model (the map sweep, Maya, a thread on a
-- note, the personality read).
--
-- Both lists are folder paths relative to the vault, matched as a prefix of a
-- note's path and ignoring case. A new connection starts with the common names
-- for a journal folder and nothing left out; the person changes both on the
-- vault settings page. lib/vault/map/rules.ts DEFAULT_VAULT_RULES holds the
-- same defaults, for a call that cannot read the row.
--
-- Columns only. Existing connections take the defaults; any connection that
-- should differ is set separately, against its owner's id.

set search_path = obsidian, public, extensions;

alter table obsidian.vault_connections
  add column journal_folders text[] not null default '{Me,Journal,Journals,Diary,Private}',
  add column excluded_folders text[] not null default '{}',
  add constraint vault_connections_journal_folders_ck check (
    cardinality(journal_folders) <= 50
    and array_position(journal_folders, null) is null
    and not ('' = any (journal_folders))
    and octet_length(array_to_string(journal_folders, '/')) <= 5000
  ),
  add constraint vault_connections_excluded_folders_ck check (
    cardinality(excluded_folders) <= 50
    and array_position(excluded_folders, null) is null
    and not ('' = any (excluded_folders))
    and octet_length(array_to_string(excluded_folders, '/')) <= 5000
  );

comment on column obsidian.vault_connections.journal_folders is
  'Folders whose notes are journals and never sent to a model. Matched as a path prefix, ignoring case. Set by the person on the vault settings page.';
comment on column obsidian.vault_connections.excluded_folders is
  'Folders the person asked to leave out of everything that sends notes to a model. Matched as a path prefix, ignoring case.';
