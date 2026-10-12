'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import {
  answeredBrief,
  ANSWER_MAX,
  editedBrief,
  nextField,
  PLAIN_ASKS,
  skippedBrief,
} from '@/lib/learn/essays/interview';
import { askNextQuestion } from '@/lib/learn/essays/interview-model';
import { DEFAULT_SELF_NAME, MARK_AUTHORS, readDraftMarks, type AuthorMark } from '@/lib/learn/essays/authorship';
import { rephraseContext, rephraseProblem } from '@/lib/learn/essays/rephrase';
import { rephraseSelection } from '@/lib/learn/essays/rephrase-model';
import {
  BRIEF_FIELDS,
  parseWordTarget,
  readBrief,
  readInterview,
  type BriefField,
  type EssayBrief,
  type EssayInterview,
} from '@/lib/learn/essays/model';
import { essayDay } from '@/lib/learn/essays/note';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import {
  adoptNoteVersion,
  loadBriefJson,
  loadVaultEssay,
  recordEssayNote,
  saveBriefJson,
  saveDraft,
  saveWordTarget,
  takenEssaySlugs,
} from '@/lib/learn/essays/store';
import { essayFromVault, saveEssayToVault, type EssayVaultFailure } from '@/lib/learn/essays/vault';
import { createVaultClient } from '@/lib/vault/auth/server';
import { noteCreatePorts, noteSavePorts, openConnectedSource } from '@/lib/vault/db/ports';
import { embedVaultNotes } from '@/lib/vault/notes/embed';

/**
 * The editor's two writes (plan #1865). The draft saves as you type, so its
 * action answers with a result rather than throwing: the editor keeps the
 * text either way and says when a save failed.
 */

export type DraftSaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

/** Who wrote which runs of the draft, as the editor sends them (plan #1868). */
const MarksInput = z
  .array(
    z.object({
      author: z.enum(MARK_AUTHORS),
      start: z.number().int().min(0),
      length: z.number().int().min(1),
      name: z.string().max(200),
    }),
  )
  .max(5_000);

export type MarksPayload = z.infer<typeof MarksInput>;

const DraftInput = z.object({
  id: z.string().uuid(),
  // The longest essay the spec has in mind is about 2,000 words; this is far
  // past it and only stops a runaway paste.
  body: z.string().max(400_000, 'The draft is too long to save.'),
  marks: MarksInput,
});

function marksOf(data: { body: string; marks: MarksPayload }): AuthorMark[] {
  return readDraftMarks(data.marks, data.body.length);
}

// latency: optimistic
export async function saveEssayDraft(id: string, body: string, marks: MarksPayload): Promise<DraftSaveResult> {
  await requireUser();
  const parsed = DraftInput.safeParse({ id, body, marks });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not save.' };
  try {
    const supabase = await createLearnClient();
    const { updatedAt } = await saveDraft(supabase, parsed.data.id, parsed.data.body, marksOf(parsed.data));
    return { ok: true, savedAt: updatedAt };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save.' };
  }
}

export type TargetState = { error?: string; target?: number | null };

// latency: pending
export async function setEssayWordTarget(_prev: TargetState, formData: FormData): Promise<TargetState> {
  await requireUser();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Could not find that essay.' };
  const parsed = parseWordTarget(String(formData.get('target') ?? ''));
  if ('error' in parsed) return { error: parsed.error };
  try {
    const supabase = await createLearnClient();
    await saveWordTarget(supabase, id.data, parsed.target);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not set the target.' };
  }
  revalidatePath('/learn/essays');
  return { target: parsed.target };
}

export type VaultSaveResult =
  | { ok: true; savedAt: string; path: string; blobSha: string }
  | { ok: false; reason: EssayVaultFailure; error: string };

const VaultInput = DraftInput.extend({
  blobSha: z.string().trim().min(1).nullable(),
  timeZone: z.string().max(64).nullable(),
});

/** How long the embedding after a save may run, as after a note edit. */
const EMBED_AFTER_SAVE_MS = 20_000;

/**
 * Write the essay to the vault (plan #1866): the first save creates
 * Essays/<title>.md, later ones save over it from the blob SHA the editor
 * opened, one commit each. The decisions are in lib/learn/essays/vault.ts.
 * The draft goes into the essay row in the same write, so the draft and the
 * vault agree once it returns.
 */
// latency: pending
export async function saveEssayToVaultAction(
  id: string,
  body: string,
  marks: MarksPayload,
  blobSha: string | null,
  timeZone: string | null,
): Promise<VaultSaveResult> {
  const user = await requireUser();
  const parsed = VaultInput.safeParse({ id, body, marks, blobSha, timeZone });
  if (!parsed.success) {
    return { ok: false, reason: 'error', error: parsed.error.issues[0]?.message ?? 'Could not save.' };
  }
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const embed = () => {
    after(async () => {
      try {
        await embedVaultNotes(vault, await createCoreClient(), {
          userId: user.id,
          deadline: Date.now() + EMBED_AFTER_SAVE_MS,
        });
      } catch (error) {
        console.error('[essay vault] note embedding', error instanceof Error ? error.message : error);
      }
    });
  };

  const now = new Date();
  try {
    const self = await selfName(user.id);
    const result = await saveEssayToVault(
      {
        loadEssay: (essayId) => loadVaultEssay(supabase, essayId),
        takenSlugs: (exceptId) => takenEssaySlugs(supabase, exceptId),
        storeEssay: (essayId, patch) => recordEssayNote(supabase, essayId, patch),
        create: noteCreatePorts({ supabase: vault, afterSave: embed }),
        save: noteSavePorts({ supabase: vault, afterSave: embed }),
        now: () => now,
      },
      {
        id: parsed.data.id,
        body: parsed.data.body,
        blobSha: parsed.data.blobSha,
        today: essayDay(now, parsed.data.timeZone),
        marks: marksOf(parsed.data),
        self,
      },
    );
    if (!result.ok) return result;
    revalidatePath('/learn/essays');
    revalidatePath('/vault');
    return { ok: true, savedAt: now.toISOString(), path: result.path, blobSha: result.blobSha };
  } catch (error) {
    console.error('[essay vault]', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'error', error: 'The essay could not be saved to your vault. Try again in a moment.' };
  }
}

/**
 * The name the person's line in the authorship block takes: the first word
 * of their display name, or the Obsidian plugin's "Self" without one.
 */
async function selfName(userId: string): Promise<string> {
  try {
    const { displayName } = await loadAccountSettings(userId);
    return displayName?.trim().split(/\s+/)[0] || DEFAULT_SELF_NAME;
  } catch {
    return DEFAULT_SELF_NAME;
  }
}

export type ReloadResult =
  | { ok: true; body: string; blobSha: string; marks: AuthorMark[]; askMarks: boolean }
  | { ok: false; error: string };

/**
 * After a save stopped because the note changed in Obsidian: take the
 * vault's version as the draft, dropping what was typed here since. The
 * vault's version is the one the last sync read; when that is still the one
 * the editor opened, the newer one has not come in yet and nothing changes.
 */
// latency: pending
export async function reloadEssayFromVault(id: string, openedBlobSha: string | null): Promise<ReloadResult> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  try {
    const essay = await loadVaultEssay(supabase, id);
    if (!essay) return { ok: false, error: 'That essay is not there any more.' };
    if (!essay.noteId) return { ok: false, error: 'This essay has no note in your vault yet.' };
    const { data, error } = await vault
      .from('notes')
      .select('path, body, blob_sha, deleted_at')
      .eq('id', essay.noteId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const note = data as { path: string; body: string; blob_sha: string; deleted_at: string | null } | null;
    if (!note || note.deleted_at) {
      return { ok: false, error: 'The note is not in your vault any more. Saving again writes a new one.' };
    }
    if (note.blob_sha === openedBlobSha) {
      return {
        ok: false,
        error: 'Dash has not read the newer version from your vault yet. It comes in with the next sync; reload after that.',
      };
    }
    // The whole file, for the authorship block's offsets and hash. Without
    // it the marks are carried over by their words and the person is asked.
    let file: string | null = null;
    try {
      const source = await openConnectedSource(vault);
      if (typeof source !== 'string') file = await source.readBlob(note.blob_sha);
    } catch (error) {
      console.error('[essay reload] reading the file', error instanceof Error ? error.message : error);
    }
    const reloaded = essayFromVault(file, note.body, { body: essay.draftBody ?? '', marks: essay.marks ?? [] });
    await adoptNoteVersion(supabase, id, {
      path: note.path,
      body: reloaded.body,
      blobSha: note.blob_sha,
      marks: reloaded.marks,
    });
    revalidatePath('/learn/essays');
    return { ok: true, blobSha: note.blob_sha, ...reloaded };
  } catch (error) {
    console.error('[essay reload]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'The note could not be read from your vault. Try again in a moment.' };
  }
}

export type BriefResult =
  | { ok: true; brief: EssayBrief; interview: EssayInterview | null }
  | { ok: false; error: string };

const BriefInput = z.object({
  id: z.string().uuid(),
  field: z.enum(BRIEF_FIELDS),
  value: z.string().max(ANSWER_MAX * 2, 'That is longer than a brief needs; keep it to a paragraph.'),
});

function briefResult(json: unknown): BriefResult {
  return { ok: true, brief: readBrief(json), interview: readInterview(json) };
}

/**
 * One answer in the interview a new essay opens with (plan #1867). The
 * answer goes into the brief as typed, and Dash words the next question from
 * what has been said so far, one Sonnet call; without a key, or when the
 * call fails or its question breaks the rules, the spec's own question is
 * asked instead, so the interview always moves on. A blank answer skips the
 * question. An answer to a question the essay is no longer asking (another
 * tab got there first) changes nothing and returns where it is.
 */
// latency: pending
export async function answerEssayInterview(id: string, field: string, answer: string): Promise<BriefResult> {
  const user = await requireUser();
  const parsed = BriefInput.safeParse({ id, field, value: answer });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not keep that answer.' };
  const supabase = await createLearnClient();
  try {
    const row = await loadBriefJson(supabase, parsed.data.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const interview = readInterview(row.brief);
    if (interview?.status !== 'asking' || interview.field !== parsed.data.field) return briefResult(row.brief);

    const following = nextField(parsed.data.field);
    let next: { field: BriefField; ask: string } | null = null;
    if (following) {
      next = { field: following, ask: PLAIN_ASKS[following] };
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const sofar = readBrief(answeredBrief(row.brief, parsed.data.field, parsed.data.value, null));
        const spend = collectSpend();
        const asked = await askNextQuestion({
          brief: sofar,
          field: following,
          anthropicApiKey: apiKey,
          onSpend: spend.sink,
        });
        await recordLearnSpend(user.id, 'word-essay-question', spend.reports);
        if (asked.ok) next = { field: following, ask: asked.ask };
        else console.error('[essay interview]', asked.detail);
      }
    }
    const brief = answeredBrief(row.brief, parsed.data.field, parsed.data.value, next);
    await saveBriefJson(supabase, parsed.data.id, brief);
    revalidatePath('/learn/essays');
    return briefResult(brief);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not keep that answer.' };
  }
}

/** Skip the rest of the interview; what was answered stays in the brief. */
// latency: pending
export async function skipEssayInterview(id: string): Promise<BriefResult> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const supabase = await createLearnClient();
  try {
    const row = await loadBriefJson(supabase, id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const brief = skippedBrief(row.brief);
    await saveBriefJson(supabase, id, brief);
    return briefResult(brief);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not skip the interview.' };
  }
}

/** One line of the brief, edited where it is read. */
// latency: optimistic
export async function saveEssayBriefField(id: string, field: string, value: string): Promise<BriefResult> {
  await requireUser();
  const parsed = BriefInput.safeParse({ id, field, value });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not save the brief.' };
  const supabase = await createLearnClient();
  try {
    const row = await loadBriefJson(supabase, parsed.data.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const brief = editedBrief(row.brief, parsed.data.field, parsed.data.value);
    await saveBriefJson(supabase, parsed.data.id, brief);
    revalidatePath('/learn/essays');
    return briefResult(brief);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save the brief.' };
  }
}

export type RephraseResult =
  | { ok: true; from: number; to: number; original: string; text: string; name: string }
  | { ok: false; error: string };

const RephraseInput = z.object({
  id: z.string().uuid(),
  doc: z.string().max(400_000),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
});

/**
 * Rephrase on a selection, rung 4 (plan #1868): Dash rewords the selected
 * text, one Sonnet call, and the editor shows it as a change to accept or
 * reject. Nothing is written here; accepting it is an edit like any other,
 * marked as Dash's, and saved with the draft.
 */
// latency: pending
export async function rephraseEssaySelection(
  id: string,
  doc: string,
  from: number,
  to: number,
): Promise<RephraseResult> {
  const user = await requireUser();
  const parsed = RephraseInput.safeParse({ id, doc, from, to });
  if (!parsed.success || parsed.data.to > parsed.data.doc.length || parsed.data.from >= parsed.data.to) {
    return { ok: false, error: 'Select the words you want reworded first.' };
  }
  const selection = parsed.data.doc.slice(parsed.data.from, parsed.data.to);
  const problem = rephraseProblem(selection);
  if (problem) return { ok: false, error: problem };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Rephrase needs the Anthropic key, which is not set on this deployment.' };

  try {
    const supabase = await createLearnClient();
    const row = await loadBriefJson(supabase, parsed.data.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const brief = readBrief(row.brief);
    const spend = collectSpend();
    const result = await rephraseSelection({
      selection,
      ...rephraseContext(parsed.data.doc, parsed.data.from, parsed.data.to),
      claim: brief.claim,
      reader: brief.reader,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'rephrase-essay-selection', spend.reports);
    if (!result.ok) {
      console.error('[essay rephrase]', result.detail);
      return { ok: false, error: 'Dash could not reword that. Try again, or select a little more or less.' };
    }
    return {
      ok: true,
      from: parsed.data.from,
      to: parsed.data.to,
      original: selection,
      text: result.text,
      name: result.model,
    };
  } catch (error) {
    console.error('[essay rephrase]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not reword that. Try again in a moment.' };
  }
}
