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
      table: 'obsidian.note_connections',
      module: 'Vault',
      holds: 'Each week, notes they wrote recently that come back to an older note of theirs, with a sentence on what they share.',
      weight: 'intent',
      search: ['sentence'],
      title: 'sentence',
      note:
        'older_note_id and recent_note_ids point at obsidian.notes. week_ending is the day the week was read back from. ' +
        'A row with dismissed_at set is one they hid as not useful.',
    },
    {
      table: 'obsidian.maya_threads',
      module: 'Vault',
      holds: 'The questions they are working through with Maya, one per note, and where they have got to on each.',
      weight: 'intent',
      search: ['question', 'summary'],
      title: 'question',
      href: (id) => `/vault/maya/${id}`,
      note:
        'note_id points at obsidian.notes. summary is where they have got to, rewritten after each exchange. ' +
        "origin is 'asked' when they asked Maya and 'automatic' when Maya wrote unasked.",
    },
    {
      table: 'obsidian.maya_messages',
      module: 'Vault',
      holds: 'Their exchanges with Maya about their notes.',
      weight: 'intent',
      search: ['body'],
      title: 'body',
      note:
        "Read their turns (role = 'person') as intent and Maya's (role = 'maya') only as context for them, like core.conversation_turns. " +
        'thread_id points at maya_threads.',
    },
    {
      table: 'obsidian.tensions',
      module: 'Vault',
      holds: 'Places where two of their positions pull against each other.',
      weight: 'intent',
      search: ['crux'],
      title: 'crux',
    },
    {
      table: 'obsidian.courses',
      module: 'Vault',
      holds: 'Every course on their academic transcripts: the school, code, title, term, credits and grade, as written.',
      weight: 'record',
      search: ['title', 'code', 'school', 'term'],
      title: 'title',
      note:
        'transcript_id points at obsidian.transcripts. year is the year of the term where the transcript gives one. ' +
        'grade is null for a course with no grade, such as transfer credit.',
    },
    {
      table: 'obsidian.transcripts',
      module: 'Vault',
      holds: 'The academic transcripts they have uploaded, one per school record, with the original file kept.',
      weight: 'record',
      search: ['school', 'file_name'],
      title: 'school',
      note: 'The courses on each are in obsidian.courses. The file is in the private vault-transcripts bucket at storage_path.',
    },
  ],
  notSources: [
    {
      table: 'obsidian.attachments',
      reason: 'Sync bookkeeping: which images, PDFs and audio files are in the vault and where their copies are kept.',
    },
    { table: 'obsidian.jev_trial_answers', reason: 'Trial bookkeeping: Jev and Haiku on the map trial notes.' },
    { table: 'obsidian.map_merge_proposals', reason: 'Map upkeep: merges the sweep proposed.' },
    { table: 'obsidian.map_merge_resets', reason: 'Map upkeep.' },
    { table: 'obsidian.map_merges', reason: 'Map upkeep: merges applied.' },
    { table: 'obsidian.map_sweep_notes', reason: 'Map upkeep: which notes a sweep read.' },
    { table: 'obsidian.map_sweeps', reason: 'Map upkeep.' },
    { table: 'obsidian.maya_gate_checks', reason: 'Bookkeeping: which note versions Jev has looked at for Maya.' },
    { table: 'obsidian.note_embeddings', reason: 'A vector per note for matching by subject; read through notes.' },
    { table: 'obsidian.text_embeddings', reason: 'Cache: vectors of page texts matched against the notes.' },
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
