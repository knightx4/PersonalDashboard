import { noteHref } from '@/lib/vault/paths';
import type { ModuleSources } from '@/lib/sources/types';

/**
 * The vault's tables, as Goals reads them (lib/sources/types.ts). The notes
 * are the person's own writing and the map is derived from them, so both are
 * read as intent. A new table in obsidian goes in one of these two lists, or
 * the gate says so.
 */
export const vaultSources: ModuleSources = {
  sources: [
    {
      table: 'obsidian.notes',
      module: 'Vault',
      holds: 'Every note in their Obsidian vault: what they think, plan and want, in their own words.',
      weight: 'intent',
      search: ['title', 'body', 'path'],
      title: 'title',
      ref: 'path',
      href: noteHref,
      note:
        'Search with full text: `search_tsv @@ websearch_to_tsquery(\'english\', …)`. Rows with deleted_at set are gone from the vault. ' +
        'Find notes by meaning through the map as well: themes, then theme_notes.',
    },
    {
      table: 'obsidian.themes',
      module: 'Vault',
      holds: 'The subjects their notes keep coming back to, each named and described.',
      weight: 'intent',
      search: ['name', 'about'],
      title: 'name',
      href: (id) => `/vault/map/${id}`,
      note:
        'The list is short enough to read whole and pick from by judgement. A chosen theme leads to its notes through theme_notes (theme_id, note_id) and to its positions through theme_positions.',
    },
    {
      table: 'obsidian.positions',
      module: 'Vault',
      holds: 'Positions they hold, each a sentence drawn from their notes.',
      weight: 'intent',
      search: ['name', 'statement'],
      title: 'name',
      note: 'position_sources (position_id, quote) gives the sentence in the note each one came from.',
    },
    {
      table: 'obsidian.tensions',
      module: 'Vault',
      holds: 'Places where two of their positions pull against each other.',
      weight: 'intent',
      search: ['crux'],
      title: 'crux',
    },
  ],
  notSources: [
    { table: 'obsidian.map_merge_proposals', reason: 'Map upkeep: merges the sweep proposed.' },
    { table: 'obsidian.map_merge_resets', reason: 'Map upkeep.' },
    { table: 'obsidian.map_merges', reason: 'Map upkeep: merges applied.' },
    { table: 'obsidian.map_sweep_notes', reason: 'Map upkeep: which notes a sweep read.' },
    { table: 'obsidian.map_sweeps', reason: 'Map upkeep.' },
    { table: 'obsidian.position_edges', reason: 'Links between positions; read through positions.' },
    { table: 'obsidian.position_link_pairs', reason: 'Map upkeep: candidate links.' },
    { table: 'obsidian.position_link_scans', reason: 'Map upkeep.' },
    { table: 'obsidian.position_pair_scans', reason: 'Map upkeep.' },
    { table: 'obsidian.position_pairs', reason: 'Map upkeep: candidate merges.' },
    { table: 'obsidian.position_sources', reason: 'Quotes behind each position; read through positions.' },
    { table: 'obsidian.sync_runs', reason: 'Sync bookkeeping.' },
    { table: 'obsidian.theme_notes', reason: 'Join rows; read through themes.' },
    { table: 'obsidian.theme_positions', reason: 'Join rows; read through themes.' },
    { table: 'obsidian.vault_connections', reason: 'The repository connection and its token.' },
  ],
};
