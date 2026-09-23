'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { generateChain, type SweptClaim } from '@/lib/learn/graph/generate';
import { conceptsFromPrior } from '@/lib/learn/graph/from-prior';
import {
  approvedBriefSchema,
  conceptsFromBrief,
  MAX_BRIEFING_CHARS,
} from '@/lib/learn/graph/from-brief';
import { declareKnown, existingConcepts, findOrCreateSubject, saveChain } from '@/lib/learn/graph/save';
import { parseOwnUnits } from '@/lib/learn/graph/curriculum-payload';
import { placeTrackAfterResponse } from '@/lib/learn/areas/place-track';
import { ensureCurriculum, fileGoalUnder } from '@/lib/learn/graph/curriculum-store';
import { loadSubject, loadSubjects } from '@/lib/learn/graph/load';
import { nameOpeningClaims } from '@/lib/learn/graph/opening-claims';
import { MIN_CLAIMS } from '@/lib/learn/graph/opening-payload';
import { writeOpeningQuestions } from '@/lib/learn/graph/opening-probe';
import {
  attachSweepToSubject,
  loadSweep,
  seedFromSweep,
  sweepForGoal,
  writeSweep,
  type OpeningSweep,
} from '@/lib/learn/graph/opening';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { classifyNote } from '@/lib/learn/vault/classify';
import { goesToExtraction, type NoteClass } from '@/lib/learn/vault/classify-payload';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadNote } from '@/lib/vault/notes/load';
import {
  approvedChainSchema,
  keepTicked,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';

/**
 * Naming a goal, and deciding what to do with what comes back.
 *
 * Two steps and a person between them. `proposeGoal` calls the model and
 * writes nothing; `approveChain` writes what came back, and only after
 * somebody has read it.
 *
 * That gap is the cheapest check available on a generated graph and the only
 * one there is before anything gets taught. A wrong reading list is a few
 * unticked rows; a wrong graph is what every later question is asked against.
 */

export type ProposeState = {
  error?: string;
  /** Proposed, not saved. Nothing reaches the graph until you approve it. */
  chain?: ProposedChain;
  /** The words that were typed, kept for the approval that follows. */
  asked?: string;
  /** The curriculum unit this goal opens, carried to the approval. */
  unitId?: string;
};

export type ApproveState = { error?: string };

const ProposeInput = z.object({
  goal: z
    .string()
    .trim()
    .min(1, 'Say what you want to understand.')
    .max(300, 'Shorter is better here — the narrower the goal, the better this works.'),
  subjectId: z.string().uuid().nullable(),
  /** Set once the opening questions have been asked, so they are not asked twice. */
  sweepId: z.string().uuid().nullable(),
  /** The curriculum unit being opened, when the goal came from one. */
  unitId: z.string().uuid().nullable(),
});

/** A form field that is either a uuid or left empty. */
function optionalId(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The answered questions from a sweep, as generation reads them. */
function sweptClaims(sweep: OpeningSweep | null): SweptClaim[] {
  if (!sweep) return [];
  return sweep.questions
    .filter((question) => question.outcome !== null)
    .map((question) => ({
      name: question.claimName,
      claim: question.claim,
      outcome: question.outcome as SweptClaim['outcome'],
    }));
}

/**
 * The ten questions, when this is a subject you have never worked on.
 *
 * Returns the sweep to send somebody to, or null to carry straight on to the
 * chain. Null covers every ordinary reason not to ask: a goal typed inside a
 * subject, a subject you already have, something too broad to have shared
 * ground in it, and a call that came back with too little to ask about. None
 * of those is worth stopping the person for -- the sweep is an addition to the
 * flow that works today, not a gate in front of it.
 */
async function openingSweepFor(
  supabase: Awaited<ReturnType<typeof createLearnClient>>,
  userId: string,
  goal: string,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const spend = collectSpend();
  const named = await nameOpeningClaims({ asked: goal, anthropicApiKey: apiKey, onSpend: spend.sink });
  await recordLearnSpend(userId, 'name-opening-claims', spend.reports);
  if (!named.ok) return null;

  // A subject already in the graph has a starting state already, and asking
  // ten questions to establish one would be measuring what is on the screen.
  const subjects = await loadSubjects(supabase);
  if (subjects.some((subject) => subject.name.toLowerCase() === named.subject.toLowerCase())) {
    return null;
  }

  const writing = collectSpend();
  const written = await writeOpeningQuestions({
    subject: named.subject,
    claims: named.claims,
    anthropicApiKey: apiKey,
    onSpend: writing.sink,
  });
  await recordLearnSpend(userId, 'write-opening-question', writing.reports);
  if (written.questions.length < MIN_CLAIMS) return null;

  const sweep = await writeSweep(supabase, userId, {
    asked: goal,
    subjectName: named.subject,
    questions: written.questions,
  });
  return sweep.id;
}

// latency: pending
export async function proposeGoal(
  _prev: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  const user = await requireUser();

  const raw = formData.get('subjectId');
  const sweptRaw = formData.get('sweepId');
  const parsed = ProposeInput.safeParse({
    goal: formData.get('goal') ?? '',
    subjectId: typeof raw === 'string' && raw.length > 0 ? raw : null,
    sweepId: typeof sweptRaw === 'string' && sweptRaw.length > 0 ? sweptRaw : null,
    unitId: optionalId(formData.get('unitId')),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that goal.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Laying out a goal needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();

  // Before anything is laid out for a subject you have never worked on: ten
  // questions across it, answered from memory. Skipped when the goal was typed
  // inside a subject, and skipped once the questions have been asked.
  if (!parsed.data.subjectId && !parsed.data.sweepId) {
    const sweepId = await openingSweepFor(supabase, user.id, parsed.data.goal);
    if (sweepId) redirect(`/learn/opening/${sweepId}`);
  }

  // Inside a subject, the generator is told what that subject already holds so
  // it does not propose it again. Outside one, it names the subject itself and
  // there is nothing yet to dedupe against.
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];

  // What they could produce about this before reading anything. Found by the
  // words when the sweep id was not carried through, so a chain laid out days
  // later still starts from where they were.
  const swept = parsed.data.sweepId
    ? await loadSweep(supabase, parsed.data.sweepId)
    : await sweepForGoal(supabase, parsed.data.goal);

  const spend = collectSpend();
  const result = await generateChain({
    goal: parsed.data.goal,
    subject: subject?.name ?? null,
    existing,
    swept: sweptClaims(swept),
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'generate-chain', spend.reports);

  if (!result.ok) return { error: result.detail };
  return { chain: result.chain, asked: parsed.data.goal, unitId: parsed.data.unitId ?? undefined };
}

// latency: pending
export async function approveChain(
  _prev: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const user = await requireUser();

  const asked = z
    .string()
    .trim()
    .min(1)
    .max(300)
    .safeParse(formData.get('asked'));
  if (!asked.success) return { error: 'Could not work out which goal this was.' };

  const raw = formData.get('chain');
  if (typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Ask again.' };
  }

  const safe = approvedChainSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Ask again.' };

  const sweptRaw = formData.get('sweepId');
  const sweepId = typeof sweptRaw === 'string' && sweptRaw.length > 0 ? sweptRaw : null;
  const unit = z.string().uuid().safeParse(formData.get('unitId'));
  const unitId = unit.success ? unit.data : null;

  const supabase = await createLearnClient();
  let subjectId: string;
  let goalId: string | null;
  try {
    const saved = await saveChain(supabase, user.id, safe.data as ProposedChain, asked.data, { unitId });
    subjectId = saved.subjectId;
    goalId = saved.goalId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that chain.' };
  }

  // A track gets its curriculum the first time a chain is approved into it
  // (LEARN-GRAPH-SPEC, "The curriculum"), and the goal just approved is filed
  // under the unit it falls in. A failure here costs the track its curriculum
  // for now, never the chain: the track page offers to write it again.
  if (!unitId) {
    try {
      const curriculum = await ensureCurriculum(
        supabase,
        user.id,
        { id: subjectId, name: (safe.data as ProposedChain).subject },
        asked.data,
      );
      if (curriculum.ok && curriculum.goalUnitId && goalId) {
        await fileGoalUnder(supabase, goalId, curriculum.goalUnitId);
      }
    } catch (error) {
      console.error('[learn curriculum]', error instanceof Error ? error.message : error);
    }
  }

  // What they showed before any of this was laid out becomes the state the
  // subject starts in. Only ever on the way in: a claim that matches nothing
  // changes nothing, and what it seeded is counted on the subject page rather
  // than left in a log, because a concept marked known is one the views stop
  // showing you.
  let seeded = '';
  const sweep = sweepId ? await loadSweep(supabase, sweepId) : await sweepForGoal(supabase, asked.data);
  if (sweep) {
    try {
      const concepts = await existingConcepts(supabase, subjectId);
      const result = await seedFromSweep(supabase, user.id, sweep, concepts);
      await attachSweepToSubject(supabase, sweep.id, subjectId);
      seeded = `?known=${result.known}&shaky=${result.shaky}&unmatched=${result.unmatched.length}`;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Could not record what you already knew.',
      };
    }
  }

  revalidatePath('/learn/know');
  revalidatePath(`/learn/s/${subjectId}`);
  redirect(`/learn/s/${subjectId}${seeded}`);
}

/**
 * What you already know, told directly.
 *
 * Slice 6, and the same two-step as a goal: propose, read it, approve. The gap
 * matters more here than anywhere else in the module, because of what approval
 * does. A concept that lands as `known` is a concept the views deliberately
 * never show you again -- that is the pruning rule the whole graph is built on
 * -- so a wrong one is invisible from the moment it goes in. Reading eight
 * claims before that happens is the only check there is.
 */

export type PriorState = {
  error?: string;
  /** Said out loud when the paste had no claims in it. Not an error. */
  message?: string;
  chain?: ProposedChain;
};

const PriorInput = z.object({
  account: z
    .string()
    .trim()
    .min(1, 'Say what you already know.')
    .max(20000, 'That is longer than this can read at once — paste the part that says what you understood.'),
  subjectId: z.string().uuid().nullable(),
});

// latency: pending
export async function proposePrior(
  _prev: PriorState,
  formData: FormData,
): Promise<PriorState> {
  const user = await requireUser();

  const raw = formData.get('subjectId');
  const parsed = PriorInput.safeParse({
    account: formData.get('account') ?? '',
    subjectId: typeof raw === 'string' && raw.length > 0 ? raw : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Reading an account needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();

  // Same rule as a goal: inside a subject it is told what is already there so
  // it does not propose it again, outside one it names the subject itself.
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];

  const spend = collectSpend();
  const result = await conceptsFromPrior({
    subject: subject?.name ?? null,
    account: parsed.data.account,
    existing,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'concepts-from-prior', spend.reports);

  if (!result.ok) {
    return result.reason === 'nothing-in-it'
      ? { message: result.detail }
      : { error: result.detail };
  }
  return { chain: result.chain };
}

/**
 * Write what they approved, already known.
 *
 * No goal: prior learning is a floor, not something to aim at. The state is
 * set only on the nodes this write inserted, so a concept that was already in
 * the graph keeps whatever a probe established about it -- a paste saying "I
 * know this" must not overwrite the one kind of evidence in the module that
 * was collected rather than asserted.
 */
// latency: pending
export async function approvePrior(
  _prev: PriorState,
  formData: FormData,
): Promise<PriorState> {
  const user = await requireUser();

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
  let saved;
  try {
    const chain = safe.data as ProposedChain;
    saved = await saveChain(supabase, user.id, chain, chain.goalConcept, { goal: false });
    await declareKnown(supabase, user.id, saved.conceptIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  revalidatePath('/learn/know');
  revalidatePath(`/learn/s/${saved.subjectId}`);
  redirect(`/learn/s/${saved.subjectId}`);
}

/**
 * A briefing somebody wrote for you, read into things to learn.
 *
 * The same two steps again, and the same rule: `proposeBrief` calls the model
 * and writes nothing, `approveBrief` writes what came back. What differs is
 * what approval means. Prior learning lands known, because you said you knew
 * it; a briefing lands unknown, because it is a stack of claims somebody else
 * made at you and not one of them has been checked. That is what makes them
 * worth having in the graph at all -- an unknown concept can be probed, put in
 * an order, and pointed at something to read.
 *
 * No goal, for the reason a floor writes none: a briefing is ground to cover,
 * not a thing to aim at.
 */

export type BriefState = {
  error?: string;
  /** Said out loud when the paste had no claims in it. Not an error. */
  message?: string;
  chain?: ProposedChain;
};

const BriefInput = z.object({
  briefing: z
    .string()
    .trim()
    .min(1, 'Paste the briefing first.')
    .max(
      MAX_BRIEFING_CHARS,
      'That is longer than an import reads — paste the part of the briefing worth learning.',
    ),
  subjectId: z.string().uuid().nullable(),
});

// latency: pending
export async function proposeBrief(
  _prev: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const user = await requireUser();

  const raw = formData.get('subjectId');
  const parsed = BriefInput.safeParse({
    briefing: formData.get('briefing') ?? '',
    subjectId: typeof raw === 'string' && raw.length > 0 ? raw : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that briefing.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Reading a briefing needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();

  // Same rule as the other two ways in: inside a subject it is told what is
  // already there so it does not propose it again, outside one it names the
  // subject itself.
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];

  const spend = collectSpend();
  const result = await conceptsFromBrief({
    subject: subject?.name ?? null,
    briefing: parsed.data.briefing,
    existing,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  // Before the result is read: an import that failed on its eighth section
  // still spent seven calls, and the ledger measures what was spent rather
  // than what came of it.
  await recordLearnSpend(user.id, 'concepts-from-brief', spend.reports);

  if (!result.ok) {
    return result.reason === 'nothing-in-it'
      ? { message: result.detail }
      : { error: result.detail };
  }
  return { chain: result.chain };
}

/**
 * Write the rows they ticked, all of them still to learn.
 *
 * Nothing is declared known here, which is the whole difference from
 * `approvePrior` and the reason a briefing is worth importing: every node
 * lands unknown, so the subject page shows it as ground to cover and a probe
 * can go at it later.
 */
// latency: pending
export async function approveBrief(
  _prev: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const user = await requireUser();

  const raw = formData.get('chain');
  if (typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Try again.' };
  }

  const safe = approvedBriefSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Try again.' };

  // The ticks arrive as names rather than as a second copy of the chain, and
  // the same rule the screen applied is applied again here: what was ticked,
  // the edges between what survived, and nothing left floating.
  const ticked = new Set(
    formData
      .getAll('keep')
      .flatMap((value) => (typeof value === 'string' ? [value.trim().toLowerCase()] : [])),
  );
  const { chain } = keepTicked(safe.data as ProposedChain, ticked);
  if (!chain.nodes.some((node) => node.existingId === null)) {
    return { message: 'Nothing ticked, so nothing was written.' };
  }

  const supabase = await createLearnClient();
  let saved;
  try {
    saved = await saveChain(supabase, user.id, chain, chain.goalConcept, {
      goal: false,
      origin: 'briefing',
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  revalidatePath('/learn/know');
  revalidatePath(`/learn/s/${saved.subjectId}`);
  redirect(`/learn/s/${saved.subjectId}`);
}

// ---------------------------------------------------------------- from a note

export type FromNoteState = BriefState & {
  /** What the classifier decided, shown whether or not the note was read. */
  verdict?: { noteClass: NoteClass; reason: string; notePath: string };
};

const FromNoteInput = z.object({
  notePath: z.string().trim().min(1, 'Pick a note.'),
  subjectId: z.string().uuid().nullable(),
});

/**
 * Read one note in the vault for the claims it makes.
 *
 * The first slice of the vault pass in LEARN-MAP-SPEC.md, running over one
 * note that you pick rather than over all 1,244. Every stage the full sweep
 * needs is here and none of the machinery for surviving 1,244 of them is, so
 * what comes out can be looked at before anything runs at that scale.
 *
 * Stage 0 is `classifyNote`. Stages 1 to 3 are `conceptsFromBrief`, unchanged:
 * it already cuts prose on its headings, extracts per section, and drops what
 * the subject already holds. A vault note and a pasted briefing are the same
 * problem, and the only reason this is a separate action is the classifier in
 * front of it and the note it reads instead of a textarea.
 *
 * Approval is `approveBrief`. The chain is the same shape, so there is no
 * second save path and nothing new can go wrong on the way in.
 */
// latency: pending
export async function proposeFromNote(
  _prev: FromNoteState,
  formData: FormData,
): Promise<FromNoteState> {
  const user = await requireUser();

  const raw = formData.get('subjectId');
  const parsed = FromNoteInput.safeParse({
    notePath: formData.get('notePath') ?? '',
    subjectId: typeof raw === 'string' && raw.length > 0 ? raw : null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that note.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Reading a note needs ANTHROPIC_API_KEY to be set.' };

  const note = await loadNote(await createVaultClient(), parsed.data.notePath);
  if (!note) return { error: 'That note is not in the vault any more.' };

  const spend = collectSpend();
  const verdict = await classifyNote({
    title: note.title,
    body: note.body,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'classify-note', spend.reports);

  const seen = { noteClass: verdict.noteClass, reason: verdict.reason, notePath: note.path };

  // Said rather than done. A note the classifier turns down is the case worth
  // seeing on a screen, because a wrong call here is what the full sweep would
  // make 1,244 times over.
  if (!goesToExtraction(verdict.noteClass)) {
    return {
      verdict: seen,
      message: `Not read: this looks like ${verdict.noteClass}. ${verdict.reason}`,
    };
  }

  const supabase = await createLearnClient();
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];

  const reading = collectSpend();
  const result = await conceptsFromBrief({
    subject: subject?.name ?? null,
    briefing: note.body,
    existing,
    anthropicApiKey: apiKey,
    onSpend: reading.sink,
  });
  await recordLearnSpend(user.id, 'concepts-from-brief', reading.reports);

  if (!result.ok) {
    return result.reason === 'nothing-in-it'
      ? { verdict: seen, message: result.detail }
      : { verdict: seen, error: result.detail };
  }
  return { verdict: seen, chain: result.chain };
}

export type CustomTrackState = { error?: string; existing?: { id: string; name: string } };

const CustomTrackInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name the track.')
    .max(80, 'Keep the name short; say the rest in what you want from it.'),
  want: z.string().trim().max(500, 'Shorter, please: a sentence or two.'),
  units: z.string().max(4000),
});

/**
 * Make a track by name, with its curriculum, and nothing else yet
 * (LEARN-GRAPH-SPEC, "The curriculum").
 *
 * The other ways in start from a question and lay out a chain first. This one
 * starts from the track: you name it, say what you want out of it if you
 * like, and optionally write the units yourself. The curriculum is written
 * straight away (your units kept exactly, in your order, when you gave them)
 * and you land on the track to open its first unit.
 *
 * A name you already have a track under goes to that track instead of making
 * a second one: one track per subject is the rule the whole graph rests on.
 */
// latency: pending
export async function createCustomTrack(
  _prev: CustomTrackState,
  formData: FormData,
): Promise<CustomTrackState> {
  const user = await requireUser();

  const parsed = CustomTrackInput.safeParse({
    name: formData.get('name') ?? '',
    want: formData.get('want') ?? '',
    units: formData.get('units') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Could not read that.' };
  const own = parseOwnUnits(parsed.data.units);
  if (!own.ok) return { error: own.detail };

  const supabase = await createLearnClient();
  const name = parsed.data.name;
  const want = parsed.data.want || null;

  let subject: { id: string; created: boolean; placed: boolean };
  try {
    subject = await findOrCreateSubject(supabase, user.id, name);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not make that track.' };
  }

  if (subject.created) {
    if (want) await supabase.from('subjects').update({ note: want }).eq('id', subject.id);
    // Placed in the areas once the response has gone, as a track from a
    // chain is; a track with no field yet is still a track.
    placeTrackAfterResponse(supabase, user.id, {
      id: subject.id,
      name,
      context: [want ? `aimed at: ${want}` : '', own.titles.length > 0 ? `units: ${own.titles.join('; ')}` : '']
        .filter(Boolean)
        .join('. '),
    });
  }

  const curriculum = await ensureCurriculum(
    supabase,
    user.id,
    { id: subject.id, name },
    want,
    own.titles,
  ).catch((error: unknown) => ({
    ok: false as const,
    detail: error instanceof Error ? error.message : 'Could not write the curriculum.',
  }));
  // An existing track with a curriculum already keeps it; say so rather than
  // quietly dropping the units that were typed.
  if (!subject.created && curriculum.ok && !curriculum.written && own.titles.length > 0) {
    return {
      error: `You already have a track called ${name}, and its curriculum is fixed.`,
      existing: { id: subject.id, name },
    };
  }

  revalidatePath('/learn/know');
  // A failed curriculum still leaves the track, whose page offers to write it.
  redirect(`/learn/s/${subject.id}`);
}
