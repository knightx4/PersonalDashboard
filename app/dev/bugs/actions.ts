'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { isOwner, requireOwner } from '@/lib/dev/owner';
import { codeMatches } from '@/lib/feedback/code';
import { notesRoutine } from '@/lib/feedback/routine';
import { OUTSTANDING_STATUSES } from '@/lib/feedback/load';
import { startRoutineRun } from '@/lib/plan/runs';

/** One queue, one page. The old per-workspace pages redirect to it. */
function revalidateFeedback(): void {
  revalidatePath('/dev/bugs');
}

export type FeedbackActionState = {
  error?: string;
  message?: string;
};

const submitSchema = z.object({
  kind: z.enum(['bug', 'feature']),
  body: z.string().trim().min(3).max(4000),
  pagePath: z.string().max(300).nullable(),
});

/**
 * File a note -- a bug or a request -- from the header panel.
 *
 * The one action in this file that is open to every signed-in account, and the
 * one exception #417 makes. The button that posts it is in the header on every
 * page of the app, not inside /dev, so locking it to the owner would take the
 * capture away from the two accounts most likely to hit something and least
 * able to do anything else about it. Everything else here is triage -- reading,
 * rewording, closing and deleting other people's notes, and starting the run
 * that works them -- and that is the owner's, so it goes through `requireOwner`
 * below.
 *
 * `requireUser`, not `requireOwner`, on purpose. Do not "fix" it.
 *
 * The submit code goes the same way. It is the owner's code, printed nowhere
 * and known to nobody else, so asking a second account for it would be asking
 * for a value they cannot have -- the panel does not even draw the box for
 * them (#418). Still asked of the owner, because for them it is what stops a
 * note being filed by a page left open on a shared screen, and dropping it
 * would be weakening a check that is working.
 *
 * So: owner and wrong code is refused, exactly as before. Anyone else signed
 * in files without one, and whatever they typed in a field that is not there
 * is not read.
 */
// latency: pending
export async function submitFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  if ((await isOwner({ user, supabase })) && !codeMatches(String(formData.get('code') ?? ''))) {
    return { error: 'That code is not right.' };
  }

  const parsed = submitSchema.safeParse({
    kind: String(formData.get('kind') ?? 'feature'),
    body: String(formData.get('body') ?? ''),
    pagePath: String(formData.get('page_path') ?? '') || null,
  });
  if (!parsed.success) {
    return { error: 'Write a sentence or two describing it.' };
  }

  const { error } = await supabase.from('feedback_items').insert({
    user_id: user.id,
    kind: parsed.data.kind,
    body: parsed.data.body,
    page_path: parsed.data.pagePath,
    user_agent: String(formData.get('user_agent') ?? '').slice(0, 500) || null,
  });
  if (error) return { error: error.message };

  revalidateFeedback();
  return {
    message:
      parsed.data.kind === 'bug' ? 'Bug report saved.' : 'Feature request saved.',
  };
}

const statusSchema = z.enum([
  'open',
  'in_progress',
  'blocked',
  'planned',
  'done',
  'declined',
]);

/** Triage from the list page. */
// latency: pending
export async function updateFeedbackStatus(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = statusSchema.safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Missing item or status.' };

  const { error } = await supabase
    .from('feedback_items')
    .update({
      status: status.data,
      completed_at:
        status.data === 'done' || status.data === 'declined'
          ? new Date().toISOString()
          : null,
    })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateFeedback();
  return { message: 'Updated.' };
}

const editSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['bug', 'feature']),
  body: z.string().trim().min(3, 'Write a sentence or two describing it.').max(4000),
});

/**
 * Reword a note that has not been worked yet.
 *
 * These are written in a few seconds on a phone, so half of them say less than
 * they meant to -- and until now the only way to add the detail was to delete
 * the note and file it again, losing its place in the queue and its age.
 *
 * Only while it is still outstanding. A note that has been done, or declined,
 * is a record of what was asked and what was decided: editing the ask after
 * the fact would make its resolution note answer a question nobody put. The
 * check is here rather than only in the list, because it is the rule and not
 * merely the presentation of it.
 */
// latency: pending
export async function editFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const parsed = editSchema.safeParse({
    id: formData.get('id'),
    kind: String(formData.get('kind') ?? 'feature'),
    body: String(formData.get('body') ?? ''),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: existing } = await supabase
    .from('feedback_items')
    .select('status')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) return { error: 'That note no longer exists.' };
  if (!(OUTSTANDING_STATUSES as readonly string[]).includes(existing.status as string)) {
    return { error: 'That one is already closed. Reopen it first to change what it asks for.' };
  }

  const { error } = await supabase
    .from('feedback_items')
    .update({ kind: parsed.data.kind, body: parsed.data.body })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateFeedback();
  return { message: 'Saved.' };
}

/** What Dash says under an answer to a blocked note. */
const ANSWERED_REPLY =
  'Got it. This note is back in the queue with your answer, and the next notes run builds ' +
  'it from that. Run Feature Routine on this page starts one now.';

const respondSchema = z.object({
  id: z.string().uuid(),
  body: z.string().trim().min(1, 'Write your answer first.').max(4000),
});

/**
 * Answer a note that came back with a question.
 *
 * A run that cannot finish a note blocks it and writes the question in the
 * resolution note, often with lettered options and a recommendation. This is
 * the reply: the answer goes into the note's thread as a comment of yours, and
 * the note goes back in the queue in the same press.
 *
 * It used to be appended to the note's own body, dated and labelled, because
 * that was the only place a run read. #393 settled that it goes in the thread
 * instead, now that there is one: the note stays the report you filed rather
 * than growing a conversation inside it, and the card stops offering two boxes
 * that look alike. The run reads the thread before it starts -- #395.
 *
 * Blocked and planned only. Those are the two pending states -- the ones that
 * are waiting on the person rather than on a run -- and answering anything else
 * would either race a run that has the note claimed or reopen something already
 * settled.
 */
// latency: pending
export async function respondToFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const parsed = respondSchema.safeParse({
    id: formData.get('id'),
    body: String(formData.get('body') ?? ''),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: existing } = await supabase
    .from('feedback_items')
    .select('status')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) return { error: 'That note no longer exists.' };
  const status = existing.status as string;
  if (status !== 'blocked' && status !== 'planned') {
    return { error: 'Only a blocked or planned note is waiting on an answer from you.' };
  }

  // The comment first: a note put back in the queue without the answer under it
  // is a note the next run picks up and blocks again for the same reason.
  const { error: unwritten } = await supabase.from('dev_comments').insert({
    user_id: user.id,
    feedback_item_id: parsed.data.id,
    author: 'me',
    body: parsed.data.body,
  });
  if (unwritten) return { error: unwritten.message };

  const { error } = await supabase
    .from('feedback_items')
    .update({ status: 'open', completed_at: null })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  // And the thread says so. An answer here never goes to the fast reply -- the
  // run that asked is the one that reads it -- so without this the last turn
  // was yours, and a tagged one drew "replying…" for two hours over a reply
  // that was never coming. Every comment that reaches Dash gets a turn back,
  // even when all there is to say is where the answer went. A failed write
  // does not undo the answer: it is saved and the note is back in the queue.
  const { error: unsaid } = await supabase.from('dev_comments').insert({
    user_id: user.id,
    feedback_item_id: parsed.data.id,
    author: 'claude',
    body: ANSWERED_REPLY,
  });
  if (unsaid) console.error(`answer reply not written on note ${parsed.data.id}: ${unsaid.message}`);

  revalidateFeedback();
  return { message: 'Answered, and back in the queue.' };
}

// latency: pending
export async function deleteFeedback(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const { error } = await supabase
    .from('feedback_items')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateFeedback();
  return { message: 'Deleted.' };
}


/**
 * Start the routine that works this queue, now rather than on its schedule.
 *
 * Signed-in only, and it carries no input from the browser: the routine has
 * its own instructions, and the button is a "go", not a prompt box.
 */
// latency: pending
export async function runFeatureRoutine(
  // Signature is fixed by useActionState; the button sends nothing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: FeedbackActionState, _formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const result = await startRoutineRun({
    supabase,
    userId: user.id,
    job: 'notes',
    routine: notesRoutine(),
  });
  if (!result.ok) return { error: result.error };
  return { message: result.detail };
}

/**
 * Whether a run is working the queue right now, and since when.
 *
 * There is no run table to ask, and there does not need to be: the queue
 * already records this. A run claims exactly one note at a time and sets it
 * `in_progress` before it starts, so an in-progress note is a run in flight and
 * the row's `updated_at` is when it claimed it. Reading the state off the work
 * itself means nothing to keep in step -- a run that dies cannot leave a
 * "running" flag set behind it.
 *
 * What it can leave behind is the claimed note, which is why staleness is part
 * of the answer rather than left for the reader to infer. Past the cutoff the
 * honest reading flips: not "a run has been going for nine hours" but "a run
 * stopped without closing this". A batch is minutes, so two hours is well clear
 * of a slow one and well short of overnight.
 */
export type RoutineRun = {
  /** The note being worked, trimmed for a single line. */
  note: string;
  /** When it was claimed. ISO. */
  since: string;
  /** Long enough that a run is likelier to have died than to still be going. */
  stale: boolean;
};

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

// latency: instant -- a read for the button's badge, fetched without anything waiting
export async function routineRun(): Promise<RoutineRun | null> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const { data } = await supabase
    .from('feedback_items')
    .select('body, updated_at')
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .order('updated_at', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const since = row.updated_at as string;
  return {
    note: row.body as string,
    since,
    stale: Date.now() - new Date(since).getTime() > STALE_AFTER_MS,
  };
}

/**
 * How many notes are still outstanding — open, in progress, blocked or planned.
 *
 * Read when the capture panel opens rather than threaded down through the
 * shell's props: the number moves every time a note is filed or worked, and one
 * baked into a cached layout would be wrong at exactly the moment someone is
 * deciding whether to press "Run Feature Routine".
 */
// latency: instant -- a read for the header badge, fetched without anything waiting
export async function openFeedbackCount(): Promise<number> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const { count } = await supabase
    .from('feedback_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('status', [...OUTSTANDING_STATUSES]);
  return count ?? 0;
}

/** Reorder the queue by hand: 1 next, 2 normal, 3 someday. */
// latency: pending
export async function setFeedbackPriority(
  _prev: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = z.string().uuid().safeParse(formData.get('id'));
  const priority = z.coerce.number().int().min(1).max(3).safeParse(formData.get('priority'));
  if (!id.success || !priority.success) return { error: 'Missing item or priority.' };

  const { error } = await supabase
    .from('feedback_items')
    .update({ priority: priority.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidateFeedback();
  return { message: 'Priority updated.' };
}
