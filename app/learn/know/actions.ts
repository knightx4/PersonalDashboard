'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { conceptsFromPrior } from '@/lib/learn/graph/from-prior';
import { conceptsFromCourse, courseLabel } from '@/lib/learn/graph/from-course';
import { conceptsAfterRead } from '@/lib/learn/graph/course-reads';
import {
  approvedBriefSchema,
  conceptsFromBrief,
  MAX_BRIEFING_CHARS,
} from '@/lib/learn/graph/from-brief';
import { declareKnown, existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { makeCustomSubject } from '@/lib/learn/graph/curriculum-run';
import { loadSubject, loadSubjects } from '@/lib/learn/graph/load';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { addToSubjectLens } from '@/lib/learn/levels/lens-store';
import { classifyNote } from '@/lib/learn/vault/classify';
import { goesToExtraction, type NoteClass } from '@/lib/learn/vault/classify-payload';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import { loadNote } from '@/lib/vault/notes/load';
import {
  approvedChainSchema,
  keepTicked,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';

/**
 * Naming a goal drafts its topic (plan #2138.4). This was the claims graph's
 * way in: a chain of claims laid out, approved, and written to the subject.
 * The graph is now only read, so the goal goes to drafting a topic with its
 * ten levels (docs/LEARN-LEVELS-SPEC.md, "Drafting a topic"), the same press
 * as New topic on /learn/topics, and lands on the draft's page to be read and
 * approved. Nothing is asked about it until then.
 */

export type ProposeState = { error?: string };

/** A form field that is either a uuid or left empty. */
function optionalId(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const GoalInput = z
  .string()
  .trim()
  .min(2, 'Say what you want to understand.')
  .max(300, 'Shorter is better here. Name one topic, such as DCF.');

// latency: pending
export async function proposeGoal(_prev: ProposeState, formData: FormData): Promise<ProposeState> {
  const user = await requireUser();
  const goal = GoalInput.safeParse(formData.get('goal') ?? '');
  if (!goal.success) return { error: goal.error.issues[0]?.message ?? 'Could not read that goal.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting a topic needs ANTHROPIC_API_KEY to be set.' };

  const subjectId = z.string().uuid().safeParse(formData.get('subjectId'));

  const supabase = await createLearnClient();
  let id: string;
  try {
    const result = await runTopicDraft(supabase, user.id, { goal: goal.data, anthropicApiKey: apiKey });
    if (!result.ok) return { error: result.detail };
    id = result.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Drafting the topic failed.' };
  }

  // Named on a subject's page, the topic joins that subject's lens, the one
  // lens its goals read too (plan #2138.7, #2302.3). The draft is kept even
  // if this fails: it is on the map and can be added again.
  if (subjectId.success) {
    try {
      await addToSubjectLens(supabase, user.id, subjectId.data, id);
      revalidatePath('/learn/know');
    } catch (error) {
      console.error('[learn goal] subject lens', error instanceof Error ? error.message : error);
    }
  }

  revalidatePath('/learn/topics');
  redirect(`/learn/topics/${id}`);
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
 * The ideas one course on your transcript probably covered (plan #1390).
 *
 * The same first step as `proposePrior`, from a course saved on You's Work &
 * school tab instead of a paste: it calls the model and writes nothing.
 * With a track picked it proposes into that track; without one the model is
 * offered your track names and puts the course into one of them or names a
 * new one. Approval is #1391's, through saveChain and declareKnown as
 * `approvePrior` does, with the course_reads row written alongside.
 */

export type CourseState = PriorState & {
  /** The course read, shown above the list while it is checked. */
  course?: { id: string; label: string };
  /** The track the ideas were matched against, or null for a new one. */
  subjectId?: string | null;
};

const CourseInput = z.object({
  courseId: z.string().uuid('Pick a course.'),
  subjectId: z.string().uuid().nullable(),
});

// latency: pending
export async function proposeFromCourse(
  _prev: CourseState,
  formData: FormData,
): Promise<CourseState> {
  const user = await requireUser();

  const parsed = CourseInput.safeParse({
    courseId: formData.get('courseId') ?? '',
    subjectId: optionalId(formData.get('subjectId')),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not read that course.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Reading a course needs ANTHROPIC_API_KEY to be set.' };

  const { data: course, error: courseError } = await (await createYouClient())
    .from('courses')
    .select('id, school, code, title, term, year, grade')
    .eq('id', parsed.data.courseId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (courseError) return { error: 'That course could not be read. Try again.' };
  if (!course) return { error: 'That course is not saved any more.' };

  const supabase = await createLearnClient();
  const subject = parsed.data.subjectId
    ? await loadSubject(supabase, parsed.data.subjectId)
    : null;
  const existing = subject ? await existingConcepts(supabase, subject.id) : [];
  const tracks = subject ? [] : await loadSubjects(supabase);

  const spend = collectSpend();
  const result = await conceptsFromCourse({
    course,
    subject: subject?.name ?? null,
    existing,
    tracks: tracks.map((track) => track.name),
    existingIn: async (name) => {
      const track = tracks.find((t) => t.name === name);
      return track ? existingConcepts(supabase, track.id) : [];
    },
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'concepts-from-course', spend.reports);

  const read = { id: course.id, label: courseLabel(course) };
  if (!result.ok) {
    return result.reason === 'error'
      ? { course: read, error: result.detail }
      : { course: read, message: result.detail };
  }

  const matched = subject ?? tracks.find((track) => track.name === result.chain.subject) ?? null;
  return { course: read, chain: result.chain, subjectId: matched?.id ?? null };
}

/**
 * Keep the ticked ideas from a course as known, and mark the course read
 * (plan #1391).
 *
 * `approvePrior`'s path with the ticks applied first: keepTicked drops what
 * was unticked and anything left with nothing to hang on, saveChain writes the
 * rest into the track the chain names, and declareKnown marks only the ideas
 * this write inserted. Ideas the track already held are left as they were.
 * Then the course_reads row, an upsert on the course, so a second read
 * updates the same row.
 */

export type CourseApproveState = {
  error?: string;
  message?: string;
  /**
   * Set when the ideas were saved but the course could not be marked read,
   * so the screen stops offering the approval that has already happened.
   */
  savedTo?: string;
};

const CourseApproveInput = z.object({ courseId: z.string().uuid() });

// latency: pending
export async function approveFromCourse(
  _prev: CourseApproveState,
  formData: FormData,
): Promise<CourseApproveState> {
  const user = await requireUser();

  const input = CourseApproveInput.safeParse({ courseId: formData.get('courseId') ?? '' });
  const raw = formData.get('chain');
  if (!input.success || typeof raw !== 'string') return { error: 'There is nothing here to approve.' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: 'That proposal did not survive the trip. Try again.' };
  }
  const safe = approvedChainSchema.safeParse(payload);
  if (!safe.success) return { error: 'That proposal did not survive the trip. Try again.' };

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
    saved = await saveChain(supabase, user.id, chain, chain.goalConcept, { goal: false });
    await declareKnown(supabase, user.id, saved.conceptIds);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that.' };
  }

  const { data: previous } = await supabase
    .from('course_reads')
    .select('subject_id, concepts_added')
    .eq('course_id', input.data.courseId)
    .maybeSingle();
  const { error: readError } = await supabase.from('course_reads').upsert(
    {
      user_id: user.id,
      course_id: input.data.courseId,
      subject_id: saved.subjectId,
      concepts_added: conceptsAfterRead(previous ?? null, saved.subjectId, saved.conceptIds.length),
      read_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,course_id' },
  );

  revalidatePath('/learn/know');
  revalidatePath(`/learn/s/${saved.subjectId}`);
  if (readError) {
    return {
      savedTo: saved.subjectId,
      error: `The ideas were saved into ${chain.subject}, but the course could not be marked as read (${readError.message}).`,
    };
  }
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
    .min(2, 'Name the subject.')
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
  const supabase = await createLearnClient();
  const made = await makeCustomSubject(supabase, user.id, {
    name: parsed.data.name,
    want: parsed.data.want || null,
    units: parsed.data.units,
  });
  if (!made.ok) return made.existing ? { error: made.detail, existing: made.existing } : { error: made.detail };

  revalidatePath('/learn/know');
  // A failed curriculum still leaves the track, whose page offers to write it.
  redirect(`/learn/s/${made.id}`);
}
