'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { bringNoteIntoNotes, loadVaultNoteText } from '@/lib/learn/essays/bring-note';
import { readBrief } from '@/lib/learn/essays/model';
import { notesOf } from '@/lib/learn/essays/notebook';
import { planJson, readPlan, type EssayPlan } from '@/lib/learn/essays/plan';
import { loadPlanContext, savePlanJson } from '@/lib/learn/essays/store';

/**
 * Bring a vault note's text into the essay's notes page (plan #2357.3).
 * The notes are `plan.notes`, saved as typing saves them (changeEssayPlan).
 * Only the essay is written; the vault note is read, never changed.
 */

const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type BringPreview =
  | { ok: true; title: string; before: string; after: string; changed: boolean }
  | { ok: false; error: string };

export type BringResult =
  | { ok: true; plan: EssayPlan; changed: boolean }
  | { ok: false; error: string };

const GONE = 'Could not find that note. It may have been deleted from the vault.';

/** Read the essay's notes (the seed when nothing was saved) and the vault note, and join them without saving. */
async function prepare(essayId: string, noteId: string, date: string) {
  if (!Id.safeParse(essayId).success || !Id.safeParse(noteId).success || !Day.safeParse(date).success) {
    return { ok: false as const, error: GONE };
  }
  const learn = await createLearnClient();
  const row = await loadPlanContext(learn, essayId);
  if (!row) return { ok: false as const, error: 'That essay is not there any more.' };
  const note = await loadVaultNoteText(await createVaultClient(), noteId);
  if (!note) return { ok: false as const, error: GONE };
  const plan = readPlan(row.plan);
  const before = notesOf(readBrief(row.brief), plan);
  const joined = bringNoteIntoNotes(before, note, date);
  if (!joined.ok) return joined;
  return { ok: true as const, learn, plan, note, before, joined };
}

/** What the notes would be after the note is added, for the dialog to show before confirming. `date` is the person's day, YYYY-MM-DD. */
// latency: pending
export async function previewVaultNoteInNotes(essayId: string, noteId: string, date: string): Promise<BringPreview> {
  await requireUser();
  try {
    const p = await prepare(essayId, noteId, date);
    if (!p.ok) return p;
    return { ok: true, title: p.note.title || p.note.path, before: p.before, after: p.joined.text, changed: p.joined.changed };
  } catch (error) {
    console.error('[essay bring note]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not read the note. Try again in a moment.' };
  }
}

/** Add the vault note's text to the end of the essay's notes and save them. Returns the plan, whose `notes` the editor shows. */
// latency: pending
export async function addVaultNoteToNotes(essayId: string, noteId: string, date: string): Promise<BringResult> {
  await requireUser();
  try {
    const p = await prepare(essayId, noteId, date);
    if (!p.ok) return p;
    if (!p.joined.changed) return { ok: true, plan: p.plan, changed: false };
    const plan = readPlan(planJson({ ...p.plan, notes: p.joined.text }));
    await savePlanJson(p.learn, essayId, planJson(plan));
    revalidatePath(`/learn/e/${essayId}`);
    return { ok: true, plan, changed: true };
  } catch (error) {
    console.error('[essay bring note]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not add the note. Try again in a moment.' };
  }
}
