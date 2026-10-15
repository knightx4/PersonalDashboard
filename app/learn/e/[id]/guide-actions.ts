'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { readBrief } from '@/lib/learn/essays/model';
import { loadEssayDraftTarget, loadPlanContext, savePlanJson } from '@/lib/learn/essays/store';
import {
  GUIDE_MODEL,
  runModelDraft,
  runNotesMap,
  runPointEvidence,
} from '@/lib/learn/essays/guide-model';
import { evidencePrompt } from '@/lib/learn/essays/evidence';
import { logEssayCall, logEssayStageVisit } from '@/lib/learn/essays/log-store';
import {
  mapNotesPrompt,
  modelDraftPrompt,
  notesOf,
  NOTES_MAX,
  readMapReply,
} from '@/lib/learn/essays/notebook';
import {
  EVIDENCE_KINDS,
  planJson,
  readPlan,
  type EssayPlan,
  type EvidenceKind,
} from '@/lib/learn/essays/plan';

/**
 * The notes-first essay's actions (docs/LEARN-ESSAYS-SPEC.md, "Notes first").
 *
 * The person's own writing goes through `changeEssayPlan`: the notes page as
 * typed, including the answers and sources the page appends to it.
 * Each change is read against the stored plan, so two tabs do not undo each
 * other. The rest each make one Sonnet call, recorded in the Learn spend
 * ledger and logged with its response: the map of the notes, sources for one
 * cluster of it, and a model draft.
 */

export type PlanResult = { ok: true; plan: EssayPlan } | { ok: false; error: string };

const Id = z.string().uuid();

function noKey(): { ok: false; error: string } {
  return { ok: false, error: 'Dash needs the Anthropic key, which is not set on this deployment.' };
}

function enough(notes: string): boolean {
  return notes.trim().split(/\s+/).length >= 40;
}

async function context(id: string) {
  const supabase = await createLearnClient();
  const row = await loadPlanContext(supabase, id);
  if (!row) return null;
  return { supabase, brief: readBrief(row.brief), plan: readPlan(row.plan) };
}

const Change = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('notes'),
    text: z.string().max(NOTES_MAX, 'The notes are longer than one page holds.'),
  }),
  // The answer itself goes into the notes through the editor; this takes the question off the map.
  z.object({ kind: z.literal('answered'), question: z.string().min(1).max(400) }),
  // A source taken into the notes (through the editor) or dropped: either way it leaves the list.
  z.object({
    kind: z.literal('drop-find'),
    label: z.string().min(1).max(120),
    item: z.string().min(1).max(64),
  }),
]);

export type PlanChange = z.infer<typeof Change>;

function applied(plan: EssayPlan, change: PlanChange): EssayPlan {
  switch (change.kind) {
    case 'notes':
      return { ...plan, notes: change.text };
    case 'answered':
      return plan.noteMap
        ? {
            ...plan,
            noteMap: {
              ...plan.noteMap,
              questions: plan.noteMap.questions.filter((q) => q !== change.question),
            },
          }
        : plan;
    case 'drop-find':
      return {
        ...plan,
        found: plan.found
          .map((f) =>
            f.label === change.label
              ? { ...f, items: f.items.filter((i) => i.id !== change.item) }
              : f,
          )
          .filter((f) => f.items.length > 0),
      };
  }
}

/** One change the person made: their notes, a question answered, or a source taken or dropped. */
// latency: optimistic
export async function changeEssayPlan(id: string, change: PlanChange): Promise<PlanResult> {
  await requireUser();
  const parsedId = Id.safeParse(id);
  const parsed = Change.safeParse(change);
  if (!parsedId.success) return { ok: false, error: 'Could not find that essay.' };
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not keep that change.' };
  try {
    const now = await context(parsedId.data);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const plan = readPlan(planJson(applied(now.plan, parsed.data)));
    await savePlanJson(now.supabase, parsedId.data, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay notes]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not keep that change. Try again in a moment.' };
  }
}

/**
 * Dash's map of the notes, on the press of Update the map. The notes it read
 * are saved with it, so an essay whose notes were only the seed from the old
 * stages keeps them.
 */
// latency: pending
export async function updateNoteMap(id: string): Promise<PlanResult> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const notes = notesOf(now.brief, now.plan);
    if (!enough(notes)) {
      return {
        ok: false,
        error: 'Write a little more first: the map needs a paragraph or two of notes.',
      };
    }
    const prompt = mapNotesPrompt({
      question: now.brief.question,
      reader: now.brief.reader,
      notes,
      previous: now.plan.noteMap,
    });
    const spend = collectSpend();
    const reply = await runNotesMap({ prompt, anthropicApiKey: apiKey, onSpend: spend.sink });
    await recordLearnSpend(user.id, 'map-essay-notes', spend.reports);
    if (!reply.ok) {
      console.error('[essay map]', reply.detail);
      return {
        ok: false,
        error: 'Dash could not read your notes just now. Try again in a moment.',
      };
    }
    await logEssayCall(now.supabase, user.id, id, {
      stage: 'notes',
      action: 'map-essay-notes',
      model: GUIDE_MODEL,
      prompt,
      content: [{ type: 'text', text: reply.text }],
    });
    const noteMap = readMapReply(reply.text, notes, new Date().toISOString());
    if (!noteMap) {
      console.error('[essay map] unreadable reply');
      return {
        ok: false,
        error: 'Dash could not make a map of these notes. Try again, or write a little more.',
      };
    }
    const plan = { ...now.plan, notes, noteMap };
    await savePlanJson(now.supabase, id, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay map]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not read your notes just now. Try again in a moment.' };
  }
}

const EvidenceInput = z.object({
  id: Id,
  label: z.string().min(1).max(120),
  kind: z.enum(EVIDENCE_KINDS),
});

export type FindResult =
  | { ok: true; plan: EssayPlan; found: number }
  | { ok: false; error: string };

/**
 * Sources for one cluster of the map: the rule that applies, evidence, the
 * strongest objection or a real case. They wait beside the cluster until the
 * person adds one to the notes or drops it.
 */
// latency: pending
export async function findClusterEvidence(
  id: string,
  label: string,
  kind: string,
): Promise<FindResult> {
  const user = await requireUser();
  const parsed = EvidenceInput.safeParse({ id, label, kind });
  if (!parsed.success) return { ok: false, error: 'Could not search for that.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(parsed.data.id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const cluster = now.plan.noteMap?.clusters.find((c) => c.label === parsed.data.label);
    if (!cluster)
      return {
        ok: false,
        error: 'That part of the map has changed. Update the map and try again.',
      };
    const prompt = evidencePrompt({
      question: now.brief.question,
      thesis: now.plan.noteMap?.claims[0] ?? now.brief.claim,
      reader: now.brief.reader,
      point: `${cluster.label}. In the writer's words: ${cluster.quotes.slice(0, 3).join(' / ')}`,
      kind: parsed.data.kind as EvidenceKind,
    });
    const spend = collectSpend();
    const result = await runPointEvidence({
      prompt,
      kind: parsed.data.kind as EvidenceKind,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'find-point-evidence', spend.reports);
    if (!result.ok) {
      console.error('[essay evidence]', result.detail);
      return { ok: false, error: 'Dash could not search just now. Try again in a moment.' };
    }
    await logEssayCall(now.supabase, user.id, parsed.data.id, {
      stage: 'notes',
      action: 'find-point-evidence',
      kind: parsed.data.kind,
      model: GUIDE_MODEL,
      prompt,
      content: result.content,
    });
    const group = now.plan.found.find((f) => f.label === cluster.label) ?? {
      label: cluster.label,
      items: [],
    };
    const taken = new Set(group.items.map((i) => i.id));
    const items = [...group.items];
    for (const item of result.items) {
      if (items.some((i) => i.url === item.url && i.quote === item.quote)) continue;
      let n = 1;
      while (taken.has(`f${n}`)) n += 1;
      taken.add(`f${n}`);
      items.push({ ...item, id: `f${n}` });
    }
    const found = [
      { label: cluster.label, items: items.slice(-6) },
      ...now.plan.found.filter((f) => f.label !== cluster.label),
    ].slice(0, 12);
    const plan = { ...now.plan, found };
    await savePlanJson(now.supabase, parsed.data.id, planJson(plan));
    return { ok: true, plan, found: result.items.length };
  } catch (error) {
    console.error('[essay evidence]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not search just now. Try again in a moment.' };
  }
}

/**
 * Dash's model draft from the notes: a sparring partner shown beside the
 * essay and never put into it.
 */
// latency: pending
export async function writeModelDraft(id: string): Promise<PlanResult> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const notes = notesOf(now.brief, now.plan);
    if (!enough(notes)) {
      return {
        ok: false,
        error: 'Write a little more in your notes first; the model draft is built from them.',
      };
    }
    const target = await loadEssayDraftTarget(now.supabase, id);
    const prompt = modelDraftPrompt({
      question: now.brief.question,
      reader: now.brief.reader,
      target,
      notes,
    });
    const spend = collectSpend();
    const reply = await runModelDraft({ prompt, anthropicApiKey: apiKey, onSpend: spend.sink });
    await recordLearnSpend(user.id, 'draft-essay-model', spend.reports);
    if (!reply.ok || !reply.text.trim()) {
      console.error('[essay model draft]', reply.ok ? 'empty' : reply.detail);
      return {
        ok: false,
        error: 'Dash could not write a model draft just now. Try again in a moment.',
      };
    }
    await logEssayCall(now.supabase, user.id, id, {
      stage: 'draft',
      action: 'draft-essay-model',
      model: GUIDE_MODEL,
      prompt,
      content: [{ type: 'text', text: reply.text }],
    });
    const plan = {
      ...now.plan,
      notes,
      modelDraft: { text: reply.text.trim(), at: new Date().toISOString() },
    };
    await savePlanJson(now.supabase, id, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay model draft]', error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: 'Dash could not write a model draft just now. Try again in a moment.',
    };
  }
}

/** The notes or the draft was opened: one row, so where people stop is visible. */
// latency: instant
export async function logEssayView(id: string, view: string): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: Id, view: z.enum(['notes', 'draft']) }).safeParse({ id, view });
  if (!parsed.success) return;
  try {
    const supabase = await createLearnClient();
    await logEssayStageVisit(supabase, user.id, parsed.data.id, parsed.data.view);
  } catch (error) {
    console.error('[essay log]', error instanceof Error ? error.message : error);
  }
}
