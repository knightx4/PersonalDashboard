import { noteHref } from '@/lib/vault/paths';
import { parentBy, type ModuleSources, type Section } from '@/lib/sources/types';

/** The sections of the vault's nav its rows sit under (app/vault/layout.tsx). */
const NOTES: Section = { href: '/vault', label: 'Now' };
const MAP: Section = { href: '/vault/map', label: 'Map' };
const MAYA: Section = { href: '/vault/maya', label: 'Maya' };

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
      section: NOTES,
      note:
        'Search with full text: `search_tsv @@ websearch_to_tsquery(\'english\', …)`. Rows with deleted_at set are gone from the vault. ' +
        'Find notes by meaning through the map as well: themes, then theme_notes. ' +
        "voice says whose words a note is: private (their own thinking), audience (written for someone else, such as an application), clipped (someone else's words), reference (records kept to look things up). " +
        "Never read a note with voice = 'secret': it holds credentials. obsidian.readable_notes is every live note but those.",
    },
    {
      table: 'obsidian.themes',
      module: 'Vault',
      holds: 'The subjects their notes keep coming back to, each named and described.',
      weight: 'intent',
      search: ['name', 'about'],
      title: 'name',
      href: (id) => `/vault/map/${id}`,
      section: MAP,
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
      note:
        'position_sources (position_id, quote) gives the sentence in the note each one came from. ' +
        'obsidian.position_voices (position_id) counts its source notes by voice; only_for_audience is true when every one was written for someone else, so the position may be what they argued rather than what they believe.',
    },
    {
      table: 'obsidian.note_connections',
      module: 'Vault',
      holds: 'Each week, notes they wrote recently that come back to an older note of theirs, with a sentence on what they share.',
      weight: 'intent',
      search: ['sentence'],
      title: 'sentence',
      parent: parentBy('older_note_id', 'obsidian.notes'),
      note:
        'older_note_id and recent_note_ids point at obsidian.notes. week_ending is the day the week was read back from. ' +
        'A row with dismissed_at set is one they hid as not useful.',
    },
    {
      table: 'obsidian.maya_threads',
      module: 'Vault',
      holds: 'The questions they were working through with Maya before plan #1479, one per note. Read-only: the threads are in core.conversations now.',
      weight: 'intent',
      search: ['question', 'summary'],
      title: 'question',
      href: (id) => `/vault/maya/${id}`,
      section: MAYA,
      parent: parentBy('note_id', 'obsidian.notes'),
      note:
        'note_id points at obsidian.notes. summary is where they have got to, rewritten after each exchange. ' +
        "origin is 'asked' when they asked Maya and 'automatic' when Maya wrote unasked. " +
        "Every thread here was copied into core.conversations (voice 'maya', same id), which is the one to read.",
    },
    {
      table: 'obsidian.maya_messages',
      module: 'Vault',
      holds: 'Their exchanges with Maya about their notes before plan #1479. Read-only: the turns are in core.conversation_turns now.',
      weight: 'intent',
      search: ['body'],
      title: 'body',
      parent: parentBy('thread_id', 'obsidian.maya_threads'),
      note:
        "Read their turns (role = 'person') as intent and Maya's (role = 'maya') only as context for them, like core.conversation_turns. " +
        'thread_id points at maya_threads. Every message here was copied into core.conversation_turns with the same id.',
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
    {
      table: 'obsidian.note_drafts',
      reason: 'Edits made in the app waiting a few minutes to be committed; the note itself is the source.',
    },
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
    { table: 'obsidian.note_blocks', reason: 'An index of notes split at their headings, for passage search; read through notes.' },
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
