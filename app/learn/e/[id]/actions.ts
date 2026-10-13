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
  checkById,
  checkUnits,
  CHECK_ESSAY_MAX,
  DISMISSALS_TO_STOP,
  freshFindings,
  newStatuses,
  nextRung,
  type ComparedNote,
  type Finding,
  type Paragraph,
} from '@/lib/learn/essays/checks';
import { writingGuideFindings } from '@/lib/learn/essays/checks-local';
import { runCheckCall } from '@/lib/learn/essays/checks-model';
import {
  closeNote,
  insertNotes,
  loadNote,
  loadNoteStates,
  moveNotes,
  setNoteRung,
  shownNotes,
  type EssayNotes,
} from '@/lib/learn/essays/notes-store';
import { relatedNotes } from '@/lib/vault/notes/related';
import {
  BRIEF_FIELDS,
  essayTitle,
  parseWordTarget,
  readBrief,
  readInterview,
  type BriefField,
  type EssayBrief,
  type EssayInterview,
} from '@/lib/learn/essays/model';
import { essayDay, type EssayStage } from '@/lib/learn/essays/note';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import {
  adoptNoteVersion,
  hideStudyItem,
  loadBriefJson,
  loadCheckEssay,
  loadStudyEssay,
  loadVaultEssay,
  recordEssayNote,
  saveBriefJson,
  saveDraft,
  saveWordTarget,
  takenEssaySlugs,
} from '@/lib/learn/essays/store';
import { searchStudy, type StudySearch } from '@/lib/learn/essays/study-store';
import { deeperProblem, firstPassBasis, type EssayResearch } from '@/lib/learn/essays/research';
import { JUDGE_MODEL, RESEARCH_MODEL, runDeeperPass, runFirstPass } from '@/lib/learn/essays/research-model';
import { insertEssayResearch } from '@/lib/learn/essays/research-store';
import { costMicrosFor, totalMicros, type SpendReport } from '@/lib/core/spend/pricing';
import { essayFromVault, saveEssayToVault, type EssayVaultFailure } from '@/lib/learn/essays/vault';
import {
  claimNote,
  essayEvidence,
  logEntry,
  MAX_CLAIMS,
  type EssayClaim,
  type OfferedClaim,
} from '@/lib/learn/essays/finish';
import { nameEssayClaims } from '@/lib/learn/essays/finish-model';
import { loadFinishRow, markFinished, recordEvidenceItem } from '@/lib/learn/essays/finish-store';
import { logChatSession } from '@/lib/learn/chat/readings';
import { addEvidenceItems } from '@/lib/jobs/evidence/bank';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { INBOX_FOLDER, noteHref } from '@/lib/vault/paths';
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
  return writeEssayToVault(user.id, parsed.data);
}

/** The vault save both Save to vault and Finish make; `stage` raises the note's stage (plan #1873). */
async function writeEssayToVault(
  userId: string,
  data: z.infer<typeof VaultInput>,
  stage?: EssayStage,
): Promise<VaultSaveResult> {
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  const embed = () => {
    after(async () => {
      try {
        await embedVaultNotes(vault, await createCoreClient(), {
          userId: userId,
          deadline: Date.now() + EMBED_AFTER_SAVE_MS,
        });
      } catch (error) {
        console.error('[essay vault] note embedding', error instanceof Error ? error.message : error);
      }
    });
  };

  const now = new Date();
  try {
    const self = await selfName(userId);
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
        id: data.id,
        body: data.body,
        blobSha: data.blobSha,
        today: essayDay(now, data.timeZone),
        marks: marksOf(data),
        self,
        stage,
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
  noteId: z.string().uuid().nullable(),
});

/**
 * Rephrase on a selection, rung 4 (plan #1868): Dash rewords the selected
 * text, one Sonnet call, and the editor shows it as a change to accept or
 * reject. Nothing in the essay is written here; accepting it is an edit like
 * any other, marked as Dash's, and saved with the draft.
 *
 * With `noteId` it is a margin note's rung 4 (plan #1869): the selection is
 * the note's text, the note's hint goes with it, and the note moves to rung 4.
 */
// latency: pending
export async function rephraseEssaySelection(
  id: string,
  doc: string,
  from: number,
  to: number,
  noteId: string | null = null,
): Promise<RephraseResult> {
  const user = await requireUser();
  const parsed = RephraseInput.safeParse({ id, doc, from, to, noteId });
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
    const note = parsed.data.noteId ? await loadNote(supabase, parsed.data.id, parsed.data.noteId) : null;
    if (parsed.data.noteId && note?.status !== 'open') return { ok: false, error: 'That note is closed now.' };
    const spend = collectSpend();
    const result = await rephraseSelection({
      selection,
      ...rephraseContext(parsed.data.doc, parsed.data.from, parsed.data.to),
      claim: brief.claim,
      reader: brief.reader,
      guidance: note ? (note.ladder[1] ?? note.body) : undefined,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'rephrase-essay-selection', spend.reports);
    if (!result.ok) {
      console.error('[essay rephrase]', result.detail);
      return { ok: false, error: 'Dash could not reword that. Try again, or select a little more or less.' };
    }
    if (note) await setNoteRung(supabase, note, 4);
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

export type NotesResult = ({ ok: true } & EssayNotes) | { ok: false; error: string };
export type CheckResult = ({ ok: true; raised: number } & EssayNotes) | { ok: false; error: string };

const CheckInput = z.object({
  id: z.string().uuid(),
  check: z.string().max(40),
  doc: z.string().max(400_000),
});

/** How many calls of one run go at once, after the first has filled the cache. */
const CHECKS_AT_ONCE = 4;
/** Your notes compared with a paragraph for Already Said, and how much of each. */
const COMPARED_NOTES = 2;
const COMPARED_CHARS = 1_500;

/**
 * Run one named check on the draft (plan #1869; spec, "Margin notes and
 * checks"). A model check makes one Sonnet call per paragraph it reads; the
 * first goes alone so the essay is in the cache for the rest. Already Said
 * first finds your two notes nearest each paragraph and skips a paragraph
 * with none. The writing guide check runs locally and costs nothing.
 *
 * What it finds becomes margin notes: open while fewer than three are,
 * waiting after, and never twice at the same place. A check dismissed twice
 * on this essay does not run.
 */
// latency: pending
export async function runEssayCheck(id: string, checkId: string, doc: string): Promise<CheckResult> {
  const user = await requireUser();
  const parsed = CheckInput.safeParse({ id, check: checkId, doc });
  const check = parsed.success ? checkById(parsed.data.check) : null;
  if (!parsed.success || !check) return { ok: false, error: 'Could not find that check.' };
  const supabase = await createLearnClient();
  try {
    const essay = await loadCheckEssay(supabase, parsed.data.id);
    if (!essay) return { ok: false, error: 'That essay is not there any more.' };
    const states = await loadNoteStates(supabase, parsed.data.id);
    const dismissed = states.filter((note) => note.checkName === check.id && note.status === 'dismissed').length;
    if (dismissed >= DISMISSALS_TO_STOP) {
      return { ok: false, error: `You dismissed ${check.name} twice, so it no longer runs on this essay.` };
    }

    let found: Finding[];
    if (check.kind === 'local') {
      found = writingGuideFindings(parsed.data.doc);
    } else {
      if (parsed.data.doc.length > CHECK_ESSAY_MAX) {
        return { ok: false, error: 'Checks read essays up to about 4,000 words. This one is longer.' };
      }
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return { ok: false, error: 'Checks need the Anthropic key, which is not set on this deployment.' };
      const units = checkUnits(check, parsed.data.doc);
      if (units.length === 0) {
        return { ok: false, error: 'Write a paragraph or two first; there is nothing to check yet.' };
      }
      const brief = readBrief(essay.brief);
      const spend = collectSpend();
      const compare =
        check.id === 'already_said'
          ? await notesToCompare(user.id, units, essay.noteId)
          : new Map<Paragraph | null, ComparedNote[]>();
      const runnable =
        check.id === 'already_said' ? units.filter((unit) => (compare.get(unit) ?? []).length > 0) : units;
      const call = (unit: Paragraph | null) =>
        runCheckCall({
          check,
          doc: parsed.data.doc,
          unit,
          claim: brief.claim,
          reader: brief.reader,
          notes: compare.get(unit) ?? [],
          anthropicApiKey: apiKey,
          onSpend: spend.sink,
        });
      const results = runnable.length > 0 ? [await call(runnable[0])] : [];
      for (let i = 1; i < runnable.length; i += CHECKS_AT_ONCE) {
        results.push(...(await Promise.all(runnable.slice(i, i + CHECKS_AT_ONCE).map(call))));
      }
      await recordLearnSpend(user.id, 'check-essay-paragraph', spend.reports);
      const failed = results.flatMap((result) => (result.ok ? [] : [result.detail]));
      if (failed.length > 0) console.error('[essay check]', check.id, failed.join('; '));
      if (results.length > 0 && failed.length === results.length) {
        return { ok: false, error: `Dash could not run ${check.name}. Try again in a moment.` };
      }
      found = results.flatMap((result) => (result.ok && result.finding ? [result.finding] : []));
    }

    const fresh = freshFindings(check.id, found, states);
    const open = states.filter((note) => note.status === 'open').length;
    const statuses = newStatuses(open, fresh.length);
    await insertNotes(
      supabase,
      user.id,
      parsed.data.id,
      check.id,
      fresh.map((finding, i) => ({ finding, status: statuses[i] })),
    );
    return { ok: true, raised: fresh.length, ...(await shownNotes(supabase, parsed.data.id)) };
  } catch (error) {
    console.error('[essay check]', error instanceof Error ? error.message : error);
    return { ok: false, error: `Dash could not run ${check.name}. Try again in a moment.` };
  }
}

/**
 * For Already Said: your notes nearest each paragraph, at most two above the
 * related-notes floor, with the start of each. The essay's own note is left out.
 */
async function notesToCompare(
  userId: string,
  units: readonly (Paragraph | null)[],
  essayNoteId: string | null,
): Promise<Map<Paragraph | null, ComparedNote[]>> {
  const [vault, core] = await Promise.all([createVaultClient(), createCoreClient()]);
  const found = await Promise.all(
    units.map(async (unit) =>
      unit
        ? relatedNotes(vault, userId, unit.text, {
            core,
            limit: COMPARED_NOTES,
            exclude: essayNoteId ? [essayNoteId] : [],
          })
        : [],
    ),
  );
  const ids = [...new Set(found.flat().map((note) => note.noteId))];
  const bodies = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await vault.from('notes').select('id, body').in('id', ids);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string; body: string | null }[]) {
      bodies.set(row.id, (row.body ?? '').slice(0, COMPARED_CHARS));
    }
  }
  return new Map(
    units.map((unit, i) => [
      unit,
      found[i]
        .filter((note) => bodies.get(note.noteId))
        .map((note) => ({ path: note.path, title: note.title, text: bodies.get(note.noteId)! })),
    ]),
  );
}

const NoteInput = z.object({ id: z.string().uuid(), noteId: z.string().uuid() });

/** Help: the note moves one rung up the ladder (spec, "What Dash does"). Rung 4 is Suggest wording. */
// latency: optimistic
export async function helpEssayNote(id: string, noteId: string): Promise<NotesResult> {
  await requireUser();
  const parsed = NoteInput.safeParse({ id, noteId });
  if (!parsed.success) return { ok: false, error: 'Could not find that note.' };
  const supabase = await createLearnClient();
  try {
    const note = await loadNote(supabase, parsed.data.id, parsed.data.noteId);
    if (!note || note.status !== 'open') return { ok: false, error: 'That note is closed now.' };
    const rung = nextRung(note.rung);
    if (rung === null) return { ok: false, error: 'This note is as far up the ladder as Help goes.' };
    await setNoteRung(supabase, note, rung);
    return { ok: true, ...(await shownNotes(supabase, parsed.data.id)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not move the note.' };
  }
}

/** Done or Dismiss on a note; a waiting note takes its place. */
// latency: optimistic
export async function closeEssayNote(
  id: string,
  noteId: string,
  outcome: 'done' | 'dismissed',
): Promise<NotesResult> {
  await requireUser();
  const parsed = NoteInput.safeParse({ id, noteId });
  if (!parsed.success || (outcome !== 'done' && outcome !== 'dismissed')) {
    return { ok: false, error: 'Could not find that note.' };
  }
  const supabase = await createLearnClient();
  try {
    return { ok: true, ...(await closeNote(supabase, parsed.data.id, parsed.data.noteId, outcome)) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not close the note.' };
  }
}

const MovesInput = z
  .array(
    z.object({
      id: z.string().uuid(),
      quote: z.string().min(1).max(4_000),
      prefix: z.string().max(200),
      suffix: z.string().max(200),
      offset: z.number().int().min(0),
    }),
  )
  .max(200);

export type NoteMove = z.infer<typeof MovesInput>[number];

/**
 * Where the notes sit after the person's edits, as the editor has moved
 * them, sent after a draft save so a reload finds them by offset.
 */
// latency: optimistic
export async function moveEssayNotes(id: string, moves: NoteMove[]): Promise<{ ok: boolean }> {
  await requireUser();
  const parsedId = z.string().uuid().safeParse(id);
  const parsed = MovesInput.safeParse(moves);
  if (!parsedId.success || !parsed.success) return { ok: false };
  try {
    const supabase = await createLearnClient();
    await moveNotes(
      supabase,
      parsedId.data,
      parsed.data.map(({ id: noteId, ...anchor }) => ({ id: noteId, anchor })),
    );
    return { ok: true };
  } catch (error) {
    console.error('[essay notes]', error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

export type StudyResult = ({ ok: true } & StudySearch) | { ok: false; error: string };

const StudyInput = z.object({
  id: z.string().uuid(),
  // A paragraph, or the brief's question and answer; far past either.
  text: z.string().max(8_000),
});

/**
 * What you studied that bears on the paragraph you are writing (plan
 * #1863.8; spec, "From your study"), or on the brief's question and answer
 * for the interview's "What made you think this?". One embedding of the
 * text, cached, searches your note passages and positions; readings, clips,
 * card notes and the learning log are matched by the words they share with
 * it. Pinned items come first.
 */
// latency: pending -- the panel keeps its last list until the new one arrives
export async function findEssayStudy(id: string, text: string): Promise<StudyResult> {
  const user = await requireUser();
  const parsed = StudyInput.safeParse({ id, text });
  if (!parsed.success) return { ok: false, error: 'Could not search with that text.' };
  try {
    const learn = await createLearnClient();
    const essay = await loadStudyEssay(learn, parsed.data.id);
    if (!essay) return { ok: false, error: 'That essay is not there any more.' };
    const [vault, core] = await Promise.all([createVaultClient(), createCoreClient()]);
    const found = await searchStudy({
      learn,
      vault,
      core,
      userId: user.id,
      paragraph: parsed.data.text,
      essayNoteId: essay.noteId,
      pins: readBrief(essay.brief).pinned,
      hidden: essay.hidden,
    });
    return { ok: true, ...found };
  } catch (error) {
    console.error('[essay study]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not search your study just now.' };
  }
}

const HideInput = z.object({ id: z.string().uuid(), key: z.string().min(1).max(600) });

/** Hide one item from the study panel, for this essay only. */
// latency: optimistic -- the item leaves the panel at once and comes back with the error if refused
export async function hideEssayStudyItem(id: string, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const parsed = HideInput.safeParse({ id, key });
  if (!parsed.success) return { ok: false, error: 'Could not hide that.' };
  try {
    await hideStudyItem(await createLearnClient(), parsed.data.id, parsed.data.key);
    return { ok: true };
  } catch (error) {
    console.error('[essay study]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not hide that. Try again in a moment.' };
  }
}

export type ResearchResult = { ok: true; run: EssayResearch } | { ok: false; error: string };

const ResearchInput = z.object({
  id: z.string().uuid(),
  level: z.enum(['first', 'deeper']),
  doc: z.string().max(400_000),
});

/**
 * Research the essay's question, at the level whose button was pressed (plan
 * #1863.9; spec, "Research, when you ask"). Nothing runs without the press,
 * and each button shows its price first.
 *
 * The first pass searches with the brief's question and what would change
 * the writer's mind, and nothing else, so no vault text reaches a search.
 * The deeper pass reads the draft as it is in the editor, has Haiku search
 * and read up to five pages, and Sonnet mark each claim against them.
 *
 * Each run's real cost, from the API's usage, is recorded in the Learn spend
 * ledger and kept on the run, which the card shows beside the result.
 */
// latency: pending
export async function researchEssay(id: string, level: string, doc: string): Promise<ResearchResult> {
  const user = await requireUser();
  const parsed = ResearchInput.safeParse({ id, level, doc });
  if (!parsed.success) return { ok: false, error: 'Could not start that research.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Research needs the Anthropic key, which is not set on this deployment.' };

  try {
    const supabase = await createLearnClient();
    const row = await loadBriefJson(supabase, parsed.data.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const brief = readBrief(row.brief);
    const spend = collectSpend();

    if (parsed.data.level === 'first') {
      const basis = firstPassBasis(brief);
      if (!basis) return { ok: false, error: 'Write the essay’s question in the brief first; the first pass searches with it.' };
      const result = await runFirstPass({ basis, anthropicApiKey: apiKey, onSpend: spend.sink });
      await recordLearnSpend(user.id, 'research-essay-question', spend.reports);
      if (!result.ok) {
        console.error('[essay research] first', result.detail);
        return { ok: false, error: 'Dash could not find sources on that question. Try again in a moment.' };
      }
      const run = await insertEssayResearch(supabase, user.id, parsed.data.id, {
        level: 'first',
        question: brief.question,
        queries: result.queries,
        sources: result.sources,
        findings: result.positions,
        costMicros: runCost(spend.reports),
        model: RESEARCH_MODEL,
      });
      return { ok: true, run };
    }

    const problem = deeperProblem(parsed.data.doc);
    if (problem) return { ok: false, error: problem };
    const result = await runDeeperPass({
      question: brief.question,
      draft: parsed.data.doc,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(
      user.id,
      'gather-essay-sources',
      spend.reports.filter((report) => report.model !== JUDGE_MODEL),
    );
    await recordLearnSpend(
      user.id,
      'judge-essay-claims',
      spend.reports.filter((report) => report.model === JUDGE_MODEL),
    );
    if (!result.ok) {
      console.error('[essay research] deeper', result.detail);
      return { ok: false, error: 'Dash could not check the draft against the web just now. Try again in a moment.' };
    }
    const run = await insertEssayResearch(supabase, user.id, parsed.data.id, {
      level: 'deeper',
      question: brief.question,
      queries: result.queries,
      sources: result.sources,
      findings: result.claims,
      costMicros: runCost(spend.reports),
      model: `${RESEARCH_MODEL},${JUDGE_MODEL}`,
    });
    return { ok: true, run };
  } catch (error) {
    console.error('[essay research]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not finish that research. Try again in a moment.' };
  }
}

/** What a run cost in all, or null when a model it used has no price. */
function runCost(reports: SpendReport[]): number | null {
  const { micros, unpriced } = totalMicros(reports.map((report) => costMicrosFor(report.model, report.usage)));
  return unpriced > 0 ? null : micros;
}

/** A note this close to a claim is taken to hold it already, so no new note is offered. */
const CLAIM_IN_VAULT_SIMILARITY = 0.78;

export type FinishResult =
  | {
      ok: true;
      savedAt: string;
      path: string;
      blobSha: string;
      /** The claims the essay argues, each with the vault note that already holds it, if any. */
      claims: OfferedClaim[];
      /** True when the essay is already in the evidence bank, so the offer is not made again. */
      inEvidenceBank: boolean;
      finishedAt: string;
    }
  | {
      ok: false;
      error: string;
      /** Set when the note was written before Finish stopped, so the editor keeps its new blob SHA. */
      saved?: { savedAt: string; path: string; blobSha: string };
      reason?: EssayVaultFailure;
    };

/**
 * Finish the essay (plan #1873; spec, "Finishing and publishing"). It writes
 * the note to the vault with its stage raised to at least seedling, has Dash
 * name the claims the essay argues, logs the essay in the learning log with
 * them, and finds which claims your vault has no note for. The notes and the
 * evidence-bank item are offered, not made: `acceptEssayFinish` makes the
 * ones chosen. Pressing Finish again updates the log entry and offers again.
 */
// latency: pending
export async function finishEssay(
  id: string,
  body: string,
  marks: MarksPayload,
  blobSha: string | null,
  timeZone: string | null,
): Promise<FinishResult> {
  const user = await requireUser();
  const parsed = VaultInput.safeParse({ id, body, marks, blobSha, timeZone });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not finish the essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: 'Finish needs the Anthropic key, which is not set on this deployment.' };

  const saved = await writeEssayToVault(user.id, parsed.data, 'seedling');
  if (!saved.ok) return { ok: false, error: saved.error, reason: saved.reason };
  const kept = { savedAt: saved.savedAt, path: saved.path, blobSha: saved.blobSha };

  try {
    const learn = await createLearnClient();
    const row = await loadFinishRow(learn, parsed.data.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.', saved: kept };
    const brief = readBrief(row.brief);
    const title = essayTitle(parsed.data.body, row.path);

    const spend = collectSpend();
    const named = await nameEssayClaims({
      title,
      claim: brief.claim,
      draft: parsed.data.body,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'name-essay-claims', spend.reports);
    if (!named.ok) {
      console.error('[essay finish] claims', named.detail);
      return {
        ok: false,
        error:
          'Your essay is saved to the vault, but Dash could not read its claims just now. Press Finish again in a moment.',
        saved: kept,
      };
    }

    const entry = logEntry({ title, claim: brief.claim, claims: named.claims });
    await logChatSession(learn, user.id, {
      ...entry,
      ideas: named.claims,
      subject: null,
      essayId: parsed.data.id,
    });

    // Which claims the vault already holds: the nearest note to each, kept
    // when it is close enough. An embedding that fails leaves the claim new.
    const [vault, core] = await Promise.all([createVaultClient(), createCoreClient()]);
    const claims: OfferedClaim[] = await Promise.all(
      named.claims.map(async (claim) => {
        const [near] = await relatedNotes(vault, user.id, `${claim.name}. ${claim.claim}`, {
          core,
          limit: 1,
          minSimilarity: CLAIM_IN_VAULT_SIMILARITY,
          exclude: row.noteId ? [row.noteId] : [],
        });
        return { ...claim, existing: near ? { title: near.title, href: near.href } : null };
      }),
    );

    const finishedAt = new Date().toISOString();
    await markFinished(learn, parsed.data.id, finishedAt);
    revalidatePath('/learn/essays');
    return { ok: true, ...kept, claims, inEvidenceBank: Boolean(row.evidenceItemId), finishedAt };
  } catch (error) {
    console.error('[essay finish]', error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: 'Your essay is saved to the vault, but Finish could not complete. Press Finish again in a moment.',
      saved: kept,
    };
  }
}

const AcceptInput = z.object({
  id: z.string().uuid(),
  claims: z
    .array(z.object({ name: z.string().trim().min(1).max(120), claim: z.string().trim().min(1).max(600) }))
    .max(MAX_CLAIMS),
  /** The names of the claims to make a note for. */
  create: z.array(z.string().max(120)).max(MAX_CLAIMS),
  evidence: z.boolean(),
  timeZone: z.string().max(64).nullable(),
});

export type AcceptFinishResult =
  | {
      ok: true;
      created: { name: string; href: string }[];
      failed: string[];
      evidence: 'added' | 'already' | 'skipped' | 'failed';
      error: string | null;
    }
  | { ok: false; error: string };

/**
 * Make what the person chose after Finish: a short note in `Inbox/` for each
 * claim ticked, and one evidence-bank item linking to the essay. The
 * evidence item is made once an essay: asking again finds it there.
 */
// latency: pending
export async function acceptEssayFinish(
  id: string,
  claims: EssayClaim[],
  create: string[],
  evidence: boolean,
  timeZone: string | null,
): Promise<AcceptFinishResult> {
  const user = await requireUser();
  const parsed = AcceptInput.safeParse({ id, claims, create, evidence, timeZone });
  if (!parsed.success) return { ok: false, error: 'Could not add those.' };
  const input = parsed.data;

  try {
    const learn = await createLearnClient();
    const row = await loadFinishRow(learn, input.id);
    if (!row) return { ok: false, error: 'That essay is not there any more.' };
    const brief = readBrief(row.brief);
    const title = essayTitle(row.draftBody, row.path);

    const chosen = input.claims.filter((claim) => input.create.includes(claim.name));
    const created: { name: string; href: string }[] = [];
    const failed: string[] = [];
    let error: string | null = null;
    if (chosen.length > 0) {
      const vault = await createVaultClient();
      const embed = () => {
        after(async () => {
          try {
            await embedVaultNotes(vault, await createCoreClient(), {
              userId: user.id,
              deadline: Date.now() + EMBED_AFTER_SAVE_MS,
            });
          } catch (e) {
            console.error('[essay finish] note embedding', e instanceof Error ? e.message : e);
          }
        });
      };
      const ports = noteCreatePorts({ supabase: vault, afterSave: embed });
      // One at a time: each is a commit to the same repository.
      for (const claim of chosen) {
        const made = await createCapturedNote(ports, claimNote(claim, title), claim.name, INBOX_FOLDER);
        if (made.ok) created.push({ name: claim.name, href: noteHref(made.path) });
        else {
          failed.push(claim.name);
          error = made.error;
        }
      }
      if (created.length > 0) revalidatePath('/vault');
    }

    let bank: 'added' | 'already' | 'skipped' | 'failed' = 'skipped';
    if (input.evidence) {
      if (row.evidenceItemId) bank = 'already';
      else {
        const item = essayEvidence({
          id: input.id,
          title,
          claim: brief.claim,
          claims: input.claims,
          finishedOn: essayDay(new Date(), input.timeZone),
        });
        const added = await addEvidenceItems(await createJobsClient(), user.id, [item]);
        if (added.ok && added.ids[0]) {
          await recordEvidenceItem(learn, input.id, added.ids[0]);
          bank = 'added';
          revalidatePath('/jobs/material');
        } else {
          bank = 'failed';
          if (!added.ok) console.error('[essay finish] evidence', added.error);
          error = error ?? 'The essay could not be added to your evidence bank. Try again in a moment.';
        }
      }
    }
    return { ok: true, created, failed, evidence: bank, error };
  } catch (error) {
    console.error('[essay finish] accept', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not add those just now. Try again in a moment.' };
  }
}
