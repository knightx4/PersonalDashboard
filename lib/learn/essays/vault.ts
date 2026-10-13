import { createCapturedNote, type CreateNotePorts } from '@/lib/vault/notes/create';
import { saveNote, type SaveNoteFailure, type SaveNotePorts } from '@/lib/vault/notes/save';
import {
  blockMarks,
  blockMatches,
  blockRanges,
  readAuthorshipBlock,
  relocateMarks,
  shiftMarks,
  stripAuthorshipBlock,
  type AuthorMark,
  type FileRange,
} from './authorship';
import { essayTitle, readBrief } from './model';
import {
  ESSAYS_FOLDER,
  atLeastStage,
  essayNoteBody,
  essayNoteText,
  essaySlug,
  newEssayFrontmatter,
  noteBodyMarks,
  rewriteEssayFile,
  type EssayStage,
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
  /** The draft as stored and its marks, which a reload moves onto the vault's text. */
  draftBody?: string;
  marks?: AuthorMark[];
};

/** What the essay row becomes once the note is written. */
export type EssayVaultPatch = {
  noteId: string;
  path: string;
  blobSha: string;
  slug: string | null;
  draftBody: string;
  /** The draft's marks, as `draft_authorship` keeps them. */
  draftMarks: AuthorMark[];
  /** The note's ranges, as its authorship block has them (plan #1868). */
  authorship: FileRange[];
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
  /** Who wrote what in `body`: Dash's and quoted runs, as UTF-16 ranges (plan #1868). */
  marks: AuthorMark[];
  /** The name the person's line in the authorship block takes. */
  self: string;
  /** Raise the note's stage to at least this one (Finish, plan #1873). */
  stage?: EssayStage;
  /** Publish (plan #1863.11): mark the note published, first on this day (`YYYY-MM-DD`). */
  published?: string;
};

export type EssayVaultFailure = SaveNoteFailure | 'empty';

export type EssayVaultResult =
  | {
      ok: true;
      path: string;
      blobSha: string;
      /** The commit the save made; null when the vault already had this text. */
      commitSha: string | null;
      /** The note's stage as written, so Finish can name it (plan #1873). */
      stage: EssayStage;
      /** The whole file as the vault now holds it, which Publish snapshots (plan #1863.11). */
      file: string;
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

/** The stage a written essay file's frontmatter holds; draft when it has none. */
function stageOf(file: string | null): EssayStage {
  const line = file?.match(/^stage:\s*["']?([a-z]+)["']?\s*$/m);
  return atLeastStage(line?.[1], 'draft');
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
  const authorship = { marks: input.marks, self: input.self };
  // The ranges of the file as written, for the essay row.
  const ranges = (file: string | null): FileRange[] => {
    const block = file ? readAuthorshipBlock(file) : null;
    return block ? blockRanges(block) : [];
  };

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
    let written: string | null = null;
    const saved = await saveNote(ports.save, {
      path: essay.path,
      text: body,
      expectedBlobSha: input.blobSha,
      rewrite: (raw, next) => {
        const marked = { ...authorship, marks: noteBodyMarks(input.body, input.marks) };
        // A save that changes nothing but the date is no save: the file stays
        // as it is and no commit is made.
        const change = { title, stage: input.stage, published: input.published };
        const same = rewriteEssayFile(raw, next, change, fresh, marked);
        written = same === raw ? raw : rewriteEssayFile(raw, next, { ...change, updated: input.today }, fresh, marked);
        return written;
      },
    });
    if (saved.ok) {
      await store(ports, essay.id, {
        noteId: essay.noteId,
        path: essay.path,
        blobSha: saved.blobSha,
        slug: essay.slug,
        draftBody: input.body,
        draftMarks: input.marks,
        authorship: ranges(written),
      });
      return {
        ok: true,
        path: essay.path,
        blobSha: saved.blobSha,
        commitSha: saved.commitSha,
        stage: stageOf(written),
        file: written ?? '',
      };
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
  if (input.stage) fm.stage = atLeastStage(fm.stage, input.stage);
  if (input.published) {
    fm.publish = true;
    fm.published = input.published;
  }
  const file = essayNoteText(fm, input.body, authorship);
  const created = await createCapturedNote(ports.create, file, title, ESSAYS_FOLDER);
  if (!created.ok) return { ok: false, reason: created.reason, error: created.error };

  await store(ports, essay.id, {
    noteId: created.noteId,
    path: created.path,
    blobSha: created.blobSha,
    slug,
    draftBody: input.body,
    draftMarks: input.marks,
    authorship: ranges(file),
  });
  return {
    ok: true,
    path: created.path,
    blobSha: created.blobSha,
    commitSha: created.commitSha,
    stage: fm.stage,
    file,
  };
}

/** The vault's version of an essay, as the editor takes it on a reload (plan #1868). */
export type ReloadedEssay = {
  /** The text the editor gets: the note's body without its authorship block. */
  body: string;
  /** Who wrote what in `body`. */
  marks: AuthorMark[];
  /**
   * True when the block no longer matches the text, or went, while the
   * essay had marks: the note was edited elsewhere. `marks` are then the old
   * marks moved to where the same words are now, and the person is asked
   * whether to keep them or clear them.
   */
  askMarks: boolean;
};

/**
 * The editor's text and marks from the note as the vault has it. `file` is
 * the whole file (frontmatter included, which the block's offsets count),
 * or null when it could not be read; `noteBody` is the stored body, which
 * holds the block; `previous` is the draft the reload replaces.
 */
export function essayFromVault(
  file: string | null,
  noteBody: string,
  previous: { body: string; marks: readonly AuthorMark[] },
): ReloadedEssay {
  const body = stripAuthorshipBlock(noteBody);
  const block = file ? readAuthorshipBlock(file) : null;
  const moved = () => relocateMarks(previous.body, previous.marks, body);

  if (!block) {
    // A block taken off elsewhere, or a file that could not be read: the
    // marks the draft had, where their words still are.
    const marks = moved();
    return { body, marks, askMarks: previous.marks.length > 0 };
  }

  // Where the body starts in the file: the block counts from the file's start.
  const trimmed = body.replace(/(\r?\n)+$/, '');
  const start = block.text.endsWith(trimmed) ? block.text.length - trimmed.length : -1;
  const fromBlock = start < 0 ? [] : shiftMarks(blockMarks(block), -start, trimmed.length);
  if (start >= 0 && blockMatches(block)) return { body, marks: fromBlock, askMarks: false };

  // Edited elsewhere since the block was written. The old marks are moved by
  // their words; without any, the block's own ranges are the best there is.
  const marks = previous.marks.length > 0 ? moved() : fromBlock;
  return { body, marks, askMarks: previous.marks.length > 0 || fromBlock.length > 0 };
}
