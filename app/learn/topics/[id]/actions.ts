'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { checksFromText } from '@/lib/learn/levels/draft-payload';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { MAX_LEVEL } from '@/lib/learn/levels/model';
import { readDrafting } from '@/lib/learn/levels/draft-sources';
import { approveDraft, markPersonal, mergeDraftInto, settleWanted, type CitedRowKind } from '@/lib/learn/levels/store';
import { rewriteCell } from '@/lib/learn/levels/store-page';
import { carryLensTargets } from '@/lib/learn/levels/lens-store';

/**
 * What a draft topic's page does (plan #2138.2): approve it with the checks
 * as the person left them, merge it into the topic it duplicates, or draft a
 * topic its links need.
 *
 * Approval saves what was on the screen. A level whose checks were reworded
 * keeps the drafted wording beside them (`descriptor_original`), so nothing
 * lands on the map in the model's words alone without the person having read
 * them there.
 */

export type ApproveState = {
  error?: string;
  /** Per level, what is wrong with the checks typed there. */
  levels?: Record<number, string>;
};

const Id = z.string().uuid();

// latency: pending
export async function approveTopicDraft(_prev: ApproveState, formData: FormData): Promise<ApproveState> {
  await requireUser();
  const id = Id.safeParse(formData.get('topicId'));
  if (!id.success) return { error: 'Could not work out which draft this was.' };

  const checks = new Map<number, string[]>();
  const levels: Record<number, string> = {};
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const text = formData.get(`level-${level}`);
    if (typeof text !== 'string') continue;
    const read = checksFromText(text);
    if (read.ok) checks.set(level, read.checks);
    else levels[level] = `Level ${level} ${read.detail}.`;
  }
  if (Object.keys(levels).length > 0) {
    return { error: 'Some levels need fixing before this can be approved.', levels };
  }

  const supabase = await createLearnClient();
  try {
    await approveDraft(supabase, id.data, checks);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Approving the topic failed.' };
  }

  revalidatePath('/learn/topics');
  revalidatePath(`/learn/topics/${id.data}`);
  return {};
}

export type MergeState = { error?: string };

// latency: pending
export async function mergeTopicDraft(_prev: MergeState, formData: FormData): Promise<MergeState> {
  const user = await requireUser();
  const draftId = Id.safeParse(formData.get('topicId'));
  const intoId = Id.safeParse(formData.get('intoId'));
  if (!draftId.success || !intoId.success) return { error: 'Could not work out which topics these were.' };

  const supabase = await createLearnClient();
  try {
    // A draft named on a subject's page is on that subject's lens already
    // (plan #2138.7), so the topic it merges into takes its place there.
    await carryLensTargets(supabase, user.id, draftId.data, intoId.data);
    await mergeDraftInto(supabase, draftId.data, intoId.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Merging the draft failed.' };
  }

  revalidatePath('/learn/topics');
  redirect(`/learn/topics/${intoId.data}`);
}

export type WantedState = { error?: string };

const WantedInput = z.object({
  topicId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  scope: z.string().trim().max(600),
});

// latency: pending
export async function draftWantedTopic(_prev: WantedState, formData: FormData): Promise<WantedState> {
  const user = await requireUser();
  const input = WantedInput.safeParse({
    topicId: formData.get('topicId'),
    name: formData.get('name'),
    scope: formData.get('scope') ?? '',
  });
  if (!input.success) return { error: 'Could not work out which topic to draft.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Drafting a topic needs ANTHROPIC_API_KEY to be set.' };

  const supabase = await createLearnClient();
  let id: string;
  try {
    // A topic a draft's links need is drafted from the sources that draft was.
    const { data: parent } = await supabase.from('topics').select('drafting').eq('id', input.data.topicId).maybeSingle();
    const drafting = readDrafting(parent?.drafting);
    const result = await runTopicDraft(supabase, user.id, {
      goal: input.data.name,
      scope: input.data.scope || null,
      sources: drafting ? { sources: drafting.sources, performances: drafting.performances } : undefined,
      anthropicApiKey: apiKey,
    });
    if (!result.ok) return { error: result.detail };
    id = result.id;
    await settleWanted(supabase, user.id, { topicId: input.data.topicId, name: input.data.name, draftId: id });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Drafting the topic failed.' };
  }

  revalidatePath('/learn/topics');
  revalidatePath(`/learn/topics/${input.data.topicId}`);
  redirect(`/learn/topics/${id}`);
}

export type RewordState = { error?: string; saved?: boolean };

/**
 * Reword one level of an approved topic by hand (idea b4bb9641). The drafted
 * wording is kept beside the new one and the level is stamped as reworded;
 * evidence written before stays, and the page shows it as given before.
 */
// latency: pending
export async function rewordLevel(_prev: RewordState, formData: FormData): Promise<RewordState> {
  await requireUser();
  const cellId = Id.safeParse(formData.get('cellId'));
  const topicId = Id.safeParse(formData.get('topicId'));
  const text = formData.get('checks');
  if (!cellId.success || !topicId.success || typeof text !== 'string') {
    return { error: 'Could not work out which level this was.' };
  }
  const read = checksFromText(text);
  if (!read.ok) return { error: `This level ${read.detail}.` };

  const supabase = await createLearnClient();
  try {
    await rewriteCell(supabase, cellId.data, read.checks);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Rewording the level failed.' };
  }

  revalidatePath(`/learn/topics/${topicId.data}`);
  return { saved: true };
}

export type MarkState = { error?: string };

const MarkInput = z.object({
  topicId: z.string().uuid(),
  /** `cell:<id>`, `link:<id>` or `topic:<id>`, several joined by commas; `undo:` first takes the mark off. */
  target: z.string().min(1).max(4_000),
});

/**
 * Mark a draft's uncited rows personal, or take the mark off (plan #2138.11).
 * A row that names no source cannot be approved until it is cited or marked;
 * marking says it is the person's own, which is what `personal` means.
 */
// latency: pending
export async function markRowsPersonal(_prev: MarkState, formData: FormData): Promise<MarkState> {
  await requireUser();
  const input = MarkInput.safeParse({ topicId: formData.get('topicId'), target: formData.get('target') });
  if (!input.success) return { error: 'Could not work out which row this was.' };

  const undo = input.data.target.startsWith('undo:');
  const byKind = new Map<CitedRowKind, string[]>();
  for (const part of input.data.target.replace(/^undo:/, '').split(',')) {
    const [kind, id] = part.split(':');
    if ((kind === 'topic' || kind === 'cell' || kind === 'link') && Id.safeParse(id).success) {
      byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
    }
  }
  if (byKind.size === 0) return { error: 'Could not work out which row this was.' };

  const supabase = await createLearnClient();
  try {
    for (const [kind, ids] of byKind) await markPersonal(supabase, kind, ids, !undo);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Marking it personal failed.' };
  }
  revalidatePath(`/learn/topics/${input.data.topicId}`);
  return {};
}
