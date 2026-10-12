import { createCapturedNote, type CreateNotePorts } from '@/lib/vault/notes/create';
import { saveNote, type SaveNoteFailure, type SaveNotePorts } from '@/lib/vault/notes/save';
import { essayTitle, readBrief } from './model';
import {
  ESSAYS_FOLDER,
  essayNoteBody,
  essayNoteText,
  essaySlug,
  newEssayFrontmatter,
  rewriteEssayFile,
  uniqueSlug,
} from './note';

/**
 * Writing an essay to the vault (plan #1866; docs/LEARN-ESSAYS-SPEC.md,
 * "Saving").
 *
 * The first save creates the note in `Essays/`, named from the essay's title,
 * with the frontmatter the spec lists. Every later save goes through the
 * vault's own saveNote with the blob SHA the editor opened, so a note
 * changed in Obsidian since is never written over: the save stops and the
 * editor offers to reload. Each save that changes something is one commit.
 *
 * Once the note is written the essay row records where it is (`note_id`,
 * `path`, `blob_sha`) and that the draft is no longer ahead of it.
 */

/** The essay row as the save reads it. */
export type VaultEssay = {
  id: string;
  path: string;
  noteId: string | null;
  blobSha: string | null;
  slug: string | null;
  brief: unknown;
};

/** What the essay row becomes once the note is written. */
export type EssayVaultPatch = {
  noteId: string;
  path: string;
  blobSha: string;
  slug: string | null;
  draftBody: string;
};

export type EssayVaultPorts = {
  /** The essay on the person's session; null when it is not theirs. */
  loadEssay(id: string): Promise<VaultEssay | null>;
  /** Slugs the person's other essays hold, so a new one is not a repeat. */
  takenSlugs(exceptId: string): Promise<Set<string>>;
  /** Record the note on the essay and clear `unsaved`. */
  storeEssay(id: string, patch: EssayVaultPatch): Promise<void>;
  create: CreateNotePorts;
  save: SaveNotePorts;
  now?: () => Date;
};

export type EssayVaultInput = {
  id: string;
  /** The text as the editor holds it, without frontmatter. */
  body: string;
  /** The blob SHA the editor opened the note at; null before the first save. */
  blobSha: string | null;
  /** Today in the person's time zone, `YYYY-MM-DD`, for the frontmatter dates. */
  today: string;
};

export type EssayVaultFailure = SaveNoteFailure | 'empty';

export type EssayVaultResult =
  | {
      ok: true;
      path: string;
      blobSha: string;
      /** The commit the save made; null when the vault already had this text. */
      commitSha: string | null;
    }
  | { ok: false; reason: EssayVaultFailure; error: string };

/** What the person reads when a save to the vault fails. */
export const ESSAY_VAULT_ERRORS: Record<EssayVaultFailure, string> = {
  empty: 'There is nothing to save to your vault yet.',
  'not-found': 'That essay is not there any more.',
  changed:
    'The note for this essay changed in Obsidian since you opened it, so this save did not write over it.',
  'read-only':
    'Your vault token can read notes but not write them, so the essay is not in your vault. Add one that can write in vault settings.',
  reconnect: 'Your vault needs reconnecting before the essay can be saved to it.',
  'too-large': 'The essay is too long to keep as a note.',
  error: 'The essay could not be saved to your vault. Try again in a moment.',
};

function failed(reason: EssayVaultFailure): EssayVaultResult {
  return { ok: false, reason, error: ESSAY_VAULT_ERRORS[reason] };
}

async function store(ports: EssayVaultPorts, id: string, patch: EssayVaultPatch): Promise<void> {
  try {
    await ports.storeEssay(id, patch);
  } catch (error) {
    // The commit has landed, so the save happened; the essay row only lags.
    // The editor keeps the new blob SHA, so its next save starts from it.
    console.error('[essay vault] recording the note on the essay', error instanceof Error ? error.message : error);
  }
}

export async function saveEssayToVault(ports: EssayVaultPorts, input: EssayVaultInput): Promise<EssayVaultResult> {
  const body = essayNoteBody(input.body);
  if (!body) return failed('empty');

  const essay = await ports.loadEssay(input.id);
  if (!essay) return failed('not-found');

  const title = essayTitle(input.body, essay.path);
  const brief = readBrief(essay.brief);

  // The note exists: save over it, from the blob the editor opened.
  if (essay.noteId && essay.blobSha) {
    // Another tab wrote the first note after this one opened.
    if (!input.blobSha) return failed('changed');
    const fresh = newEssayFrontmatter({
      title,
      slug: essay.slug ?? essaySlug(title),
      description: brief.claim,
      today: input.today,
    });
    const saved = await saveNote(ports.save, {
      path: essay.path,
      text: body,
      expectedBlobSha: input.blobSha,
      rewrite: (raw, next) => rewriteEssayFile(raw, next, { title, updated: input.today }, fresh),
    });
    if (saved.ok) {
      await store(ports, essay.id, {
        noteId: essay.noteId,
        path: essay.path,
        blobSha: saved.blobSha,
        slug: essay.slug,
        draftBody: input.body,
      });
      return { ok: true, path: essay.path, blobSha: saved.blobSha, commitSha: saved.commitSha };
    }
    // The note was deleted or moved in Obsidian: write a new one below, so
    // the words are in the vault again rather than the essay never saving.
    if (saved.reason !== 'not-found') {
      if (saved.reason === 'error') console.error('[essay vault] saving', saved.detail);
      return failed(saved.reason);
    }
  }

  // The first save, or a note that went: a new note in Essays/, named from the title. A file
  // already at that name is never written over; the next number is tried.
  const slug = essay.slug ?? uniqueSlug(essaySlug(title), await ports.takenSlugs(essay.id));
  const fm = newEssayFrontmatter({ title, slug, description: brief.claim, today: input.today });
  const created = await createCapturedNote(ports.create, essayNoteText(fm, input.body), title, ESSAYS_FOLDER);
  if (!created.ok) return { ok: false, reason: created.reason, error: created.error };

  await store(ports, essay.id, {
    noteId: created.noteId,
    path: created.path,
    blobSha: created.blobSha,
    slug,
    draftBody: input.body,
  });
  return { ok: true, path: created.path, blobSha: created.blobSha, commitSha: created.commitSha };
}
