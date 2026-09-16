'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReading } from '@/lib/learn/tracks/load';
import { locatePassage } from '@/lib/learn/locate/locate';
import { suggestSources } from '@/lib/learn/import/suggest';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { conceptsFromNote } from '@/lib/learn/graph/from-note';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { loadGraph, loadSubject, subjectIdOfConcept } from '@/lib/learn/graph/load';
import { isRooted, rootingFor, type Rooting } from '@/lib/learn/graph/rooting';
import { aimFor, type Aim } from '@/lib/learn/graph/aim';
import { approvedChainSchema, type ProposedChain } from '@/lib/learn/graph/chain-payload';
import { resolvedSourceSchema, type ResolvedSource } from '@/lib/learn/import/resolve-payload';
import {
  attachSourceToReading,
  createTrack,
  setReadNow,
  setReadingLocation,
  setReadingNote,
  setReadingStatus,
} from '@/lib/learn/tracks/save';

/**
 * What you can do to a reading.
 *
 * Every write goes through the session client, so RLS decides which row is
 * touched. The reading id comes from the form and is not trusted for
 * ownership -- the policy answers that, and a row belonging to somebody else
 * simply is not there to update.
 */

export type ReadingActionState = { error?: string };

/**
 * What the search was told about you, said out loud beside the results.
 *
 * Absent for a reading you typed, which has no graph behind it and nothing to
 * claim. Present for one queued from a gap, and then it is either the number
 * of settled claims the search was given or an admission that there were
 * none -- a suggestion that says it is rooted in what you know, when the graph
 * holds nothing, is the guess this was built to replace.
 */
export type RootingNote =
  | { rooted: true; settled: number; subject: string }
  | { rooted: false; subject: string };

export type FindState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the row until you pick one. */
  candidates?: ResolvedSource[];
  rooting?: RootingNote;
};

/**
 * What the subject's graph knows, when this reading came from a gap in one.
 *
 * Two things, off one read: the claim this reading is for, and everything
 * around it. The aim is read here rather than copied onto the reading when it
 * was queued, so a claim you have re-probed since searches on where you stand
 * now.
 *
 * Everything here can be missing without it being a fault: a reading you typed
 * has no concept, and a concept whose subject was deleted since has no graph.
 * Both end with no aim and no rooting rather than an error, because the search
 * still works -- it just works the way it did before.
 */
async function graphBehindReading(
  supabase: Awaited<ReturnType<typeof createLearnClient>>,
  conceptId: string | null,
): Promise<{ aim: Aim | null; rooting: Rooting; note: RootingNote } | null> {
  if (!conceptId) return null;

  const subjectId = await subjectIdOfConcept(supabase, conceptId);
  if (!subjectId) return null;

  const [subject, graph] = await Promise.all([
    loadSubject(supabase, subjectId),
    loadGraph(supabase, subjectId),
  ]);
  if (!subject) return null;

  // The concept can be gone from the graph while its subject is still there --
  // deleted since the reading was queued. No aim, and the rooting is still
  // worth having.
  const concept = graph.concepts.find((c) => c.id === conceptId);
  const rooting = rootingFor(graph, conceptId);

  return {
    aim: concept ? aimFor(concept) : null,
    rooting,
    note: isRooted(rooting)
      ? { rooted: true, settled: rooting.settled.length, subject: subject.name }
      : { rooted: false, subject: subject.name },
  };
}

/**
 * Find something to read about a subject you wrote down.
 *
 * Proposes and writes nothing, which is the same rule the import path follows
 * and matters more here: a search given only a subject has far more room to be
 * wrong than one given a citation, and a bad source in a queue costs twenty
 * minutes at the moment you were finally going to read something.
 *
 * A reading queued from a gap searches on the claim it was queued for, with
 * its subject's graph behind it -- what you have settled, and what you are
 * ready for -- so the results skip the introduction you do not need and the
 * paper that starts three steps past you. Which of those two happened is
 * reported back rather than assumed.
 */
// latency: pending
export async function findSources(_prev: FindState, formData: FormData): Promise<FindState> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) return { error: 'Could not work out which one to search for.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Searching needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) return { error: 'That is not there any more.' };

  const behind = await graphBehindReading(supabase, reading.conceptId);

  // The aim replaces the track's question rather than joining it. A gap
  // reading's track question is the claim of whichever gap was queued most
  // recently, which is some other claim as often as not, and sending both aims
  // the search at two things.
  const aim = behind?.aim ?? null;

  const spend = collectSpend();
  const result = await suggestSources({
    subject: reading.subject,
    question: aim ? null : reading.trackQuestion,
    aim,
    rooting: behind?.rooting ?? null,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'suggest-sources', spend.reports);

  if (!result.ok) return { error: result.detail, rooting: behind?.note };
  return { candidates: result.sources, rooting: behind?.note };
}

/**
 * Attach the one you picked.
 *
 * The payload rides back through a hidden field, so it is re-validated here
 * rather than trusted -- a form field is user input whoever wrote the form.
 */
// latency: pending
export async function attachSource(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) return { error: 'Could not work out which one to attach to.' };

  const raw = formData.get('chosen');
  if (typeof raw !== 'string') return { error: 'Pick one first.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'That choice did not survive the trip. Search again.' };
  }

  const safe = resolvedSourceSchema.safeParse(parsed);
  if (!safe.success) return { error: 'That choice did not survive the trip. Search again.' };

  const supabase = await createLearnClient();
  try {
    await attachSourceToReading(supabase, user.id, readingId.data, safe.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not attach that.' };
  }

  revalidatePath(`/learn/r/${readingId.data}`);
  revalidatePath('/learn');
  return {};
}

const StatusInput = z.object({
  readingId: z.string().uuid(),
  status: z.enum(['queued', 'reading', 'read', 'abandoned']),
});

// latency: pending
export async function updateStatus(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  await requireUser();

  const parsed = StatusInput.safeParse({
    readingId: formData.get('readingId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: 'That is not a status.' };

  const supabase = await createLearnClient();
  try {
    await setReadingStatus(supabase, parsed.data.readingId, parsed.data.status);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update that.' };
  }

  revalidatePath(`/learn/r/${parsed.data.readingId}`);
  revalidatePath('/learn');
  // Finishing or giving up takes it off the shelf, so the shelf has changed.
  revalidatePath('/learn/now');
  return {};
}

const ReadNowInput = z.object({
  readingId: z.string().uuid(),
  on: z.enum(['on', 'off']),
});

/** Put this on the Read now shelf, or take it off. */
// latency: pending -- should be optimistic: a toggle that waits for the round trip
export async function toggleReadNow(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  await requireUser();

  const parsed = ReadNowInput.safeParse({
    readingId: formData.get('readingId'),
    on: formData.get('on'),
  });
  if (!parsed.success) return { error: 'Could not work out which one you meant.' };

  const supabase = await createLearnClient();
  try {
    await setReadNow(supabase, parsed.data.readingId, parsed.data.on === 'on');
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not change the shelf.' };
  }

  revalidatePath(`/learn/r/${parsed.data.readingId}`);
  revalidatePath('/learn/now');
  revalidatePath('/learn');
  return {};
}

const NoteInput = z.object({
  readingId: z.string().uuid(),
  note: z.string().max(20_000),
});

// latency: pending
export async function updateNote(
  _prev: ReadingActionState,
  formData: FormData,
): Promise<ReadingActionState> {
  await requireUser();

  const parsed = NoteInput.safeParse({
    readingId: formData.get('readingId'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: 'That note is too long to save.' };

  const supabase = await createLearnClient();
  try {
    await setReadingNote(supabase, parsed.data.readingId, parsed.data.note);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save your note.' };
  }

  revalidatePath(`/learn/r/${parsed.data.readingId}`);
  return {};
}

/**
 * Open it — and, on the way, find the paragraph.
 *
 * This is the lazy locate pass, and it is a server action rather than a link
 * because the work happens between the click and the tab: fetch the document,
 * find the passage that answers the track's question, verify the phrase is
 * really in the page, then redirect to a URL that lands on it.
 *
 * Doing it here rather than at import time is what keeps the cost proportional
 * to what you actually read. A track of twenty readings costs nothing until
 * you start it.
 *
 * It never fails the click. Every way this can go wrong -- a paywall, a PDF, a
 * page that moved, a model that invents the quote -- ends with the URL you
 * already had and a basis recorded saying why it could not be narrowed. Being
 * sent to the top of the right page is the floor, not an error.
 */
// latency: pending
export async function openReading(formData: FormData): Promise<void> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) redirect('/learn');

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) redirect('/learn');

  // A reading you wrote down yourself has nowhere to go yet. Back to its own
  // page, which says so.
  const url = reading.openUrl ?? reading.source?.canonicalUrl ?? null;
  if (!url) redirect(`/learn/r/${readingId.data}`);

  // Already narrowed and checked: nothing to do but go.
  if (reading.locatorConfidence === 'verified' && reading.textAnchor) {
    if (reading.status === 'queued') {
      await setReadingStatus(supabase, reading.id, 'reading').catch(() => {});
    }
    redirect(url);
  }

  const spend = collectSpend();
  const outcome = await locatePassage({
    url: reading.source?.canonicalUrl ?? url,
    question: reading.trackQuestion,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'locate-passage', spend.reports);

  await setReadingLocation(supabase, reading.id, outcome).catch(() => {});
  if (reading.status === 'queued') {
    await setReadingStatus(supabase, reading.id, 'reading').catch(() => {});
  }

  revalidatePath(`/learn/r/${reading.id}`);
  redirect(outcome.openUrl);
}

export type NoteGraphState = {
  error?: string;
  message?: string;
  /** Proposed, not saved. Nothing reaches the graph until it is approved. */
  chain?: ProposedChain;
  subjectId?: string;
};

/**
 * Read the note you already wrote for the concepts it introduced.
 *
 * Growth trigger 4, and the half of the join that asks nothing new of you: the
 * note is written anyway. Proposed rather than added, because a note is a
 * rough thing written for yourself and half of what a model finds in one is
 * phrasing rather than concepts.
 *
 * The subject is picked rather than guessed. A subject is the container that
 * accumulates, and the spec is explicit that nothing auto-creates one --
 * getting it wrong twice leaves somebody with two half-graphs.
 */
// latency: pending
export async function readNoteIntoGraph(
  _prev: NoteGraphState,
  formData: FormData,
): Promise<NoteGraphState> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!readingId.success) return { error: 'Could not work out which reading that was.' };
  if (!subjectId.success) return { error: 'Pick which subject this belongs to.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) return { error: 'That reading is not there any more.' };
  if (!reading.note?.trim()) {
    return { error: 'Write a note first — that is what this reads.' };
  }

  const subject = await loadSubject(supabase, subjectId.data);
  if (!subject) return { error: 'That subject is not there any more.' };

  const spend = collectSpend();
  const result = await conceptsFromNote({
    subject: subject.name,
    readingTitle: reading.subject,
    note: reading.note,
    existing: await existingConcepts(supabase, subject.id),
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'concepts-from-note', spend.reports);

  if (!result.ok) {
    return result.reason === 'nothing-in-it'
      ? { message: result.detail }
      : { error: result.detail };
  }

  return { chain: result.chain, subjectId: subject.id };
}

/** Attach what the note taught. The same writer as any other chain, minus the goal. */
// latency: pending
export async function approveNoteConcepts(
  _prev: NoteGraphState,
  formData: FormData,
): Promise<NoteGraphState> {
  const user = await requireUser();

  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));
  if (!subjectId.success) return { error: 'Could not work out which subject that was.' };

  const raw = formData.get('chain');
  if (typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Try again.' };
  }

  const safe = approvedChainSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Try again.' };

  const supabase = await createLearnClient();
  try {
    await saveChain(supabase, user.id, safe.data as ProposedChain, safe.data.goalConcept, {
      goal: false,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  revalidatePath(`/learn/s/${subjectId.data}`);
  revalidatePath('/learn/know');
  return { message: 'Added to your graph.' };
}

/**
 * Open one step of a route up into a route of its own.
 *
 * The subject goes in as a new topic remembering the track it came from, and
 * that is all this does: nothing is planned and nothing is searched for until
 * you press Plan this topic on the page it lands you on. Same shape as keeping
 * an area of a topic too broad to plan, one level down.
 *
 * The step itself is untouched. Going deeper on "what a central bank does" is
 * not a decision to stop reading the thing that raised it, and Find sources on
 * this page is still the other move -- more to read about the subject as it
 * stands, where this one breaks it into parts.
 */
// latency: pending
export async function goDeeper(formData: FormData): Promise<void> {
  const user = await requireUser();

  const readingId = z.string().uuid().safeParse(formData.get('readingId'));
  if (!readingId.success) redirect('/learn');

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, readingId.data);
  if (!reading) redirect('/learn');

  // Your own words for the step when there are any: `subject` falls back to
  // the source's title, and "Spheres of Justice" is a book, not the thing you
  // wanted to understand.
  const trackId = await createTrack(supabase, user.id, {
    title: reading.title ?? reading.subject,
    question: reading.why,
    branchedFrom: reading.trackId,
  });

  revalidatePath('/learn');
  revalidatePath(`/learn/t/${reading.trackId}`);
  redirect(`/learn/t/${trackId}`);
}
