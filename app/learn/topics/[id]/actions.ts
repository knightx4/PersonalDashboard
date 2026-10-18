'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { writeCardsForBrief } from '@/inngest/learn/feed-top-up';
import { approveDraftedTopic } from '@/lib/learn/briefs/topics-store';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { checksFromText } from '@/lib/learn/levels/draft-payload';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { readDrafting } from '@/lib/learn/levels/draft-sources';
import { markPersonal, mergeDraftInto, settleWanted, type CitedRowKind } from '@/lib/learn/levels/store';
import { rewriteCell } from '@/lib/learn/levels/store-page';
import { carryLensTargets } from '@/lib/learn/levels/lens-store';

/**
 * What a draft topic's page does (plan #2138.2): merge it into the topic it
 * duplicates, mark its rows personal, or draft a topic its links need. Dash
 * approves a draft as soon as it is written (plan #2356), so there is no
 * action here that approves one.
 */

const Id = z.string().uuid();

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
      // A topic a brief's draft needs is from that brief too (plan #2184.1).
      ...(drafting?.brief ? { brief: drafting.brief } : {}),
      anthropicApiKey: apiKey,
    });
    if (!result.ok) return { error: result.detail };
    id = result.id;
    await settleWanted(supabase, user.id, { topicId: input.data.topicId, name: input.data.name, draftId: id });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Drafting the topic failed.' };
  }
  // Approved as soon as it is kept (plan #2356.2), uncited rows marked
  // personal; the draft stays if approving fails, and its page says it is held.
  const approval = await approveDraftedTopic(supabase, user.id, id).catch((error: unknown) => {
    console.error('[learn topics] approve on draft', error instanceof Error ? error.message : error);
    return null;
  });
  if (approval?.brief) {
    const { briefId } = approval.brief;
    after(() => writeCardsForBrief(user.id, briefId).then(() => undefined));
    revalidatePath(`/learn/b/${briefId}`);
    revalidatePath('/learn/now');
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
