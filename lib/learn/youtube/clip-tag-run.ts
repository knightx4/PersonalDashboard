import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadSubjects } from '@/lib/learn/graph/load';
import { TAG_BATCH, tagClipBatch, type ClipToTag, type SubjectToTag } from './clip-tags';

/**
 * The one-off pass that tags the clips already cut with their subjects (plan
 * #1696, under #1694).
 *
 * Reads every clip whose tagged_at is null, by person, oldest cut first, in
 * batches of fifty, and sends each batch with the person's subjects to Haiku
 * (clip-tags.ts). Each subject a clip serves gets a learn.video_clip_subjects
 * row, added and never removed, and every clip in the batch gets tagged_at,
 * whether it fit a subject or not, so a second run reads none of them again.
 * A call that failed writes nothing and the batch comes up next run. A person
 * with no subjects is skipped and their clips stay unchecked, so they are read
 * once a subject exists.
 *
 * Clips cut from #1695 on are stamped at the cut (clip-run.ts), so once the
 * backlog is through, this pass costs one read a run. Runs from
 * `npm run clips:tag` and, a few batches at a time, from the library run.
 *
 * Runs with the service client, so every read and write names the person.
 */

/** Batches sent per scheduled run: the 261 clips unchecked in October 2026 take two runs. */
export const TAG_BATCHES_PER_RUN = 3;
const PAGE = 1000;

export type TagPassResult = {
  /** Clips read and marked checked this run. */
  checked: number;
  /** Of those, clips that fit at least one subject. */
  tagged: number;
  /** Of those, clips that fit none. */
  fitNothing: number;
  /** Tag rows written that were not there already. */
  tags: number;
  /** Batches whose call failed; their clips come up next run. */
  failed: number;
  /** Clips still unchecked after this run. */
  waiting: number;
  stopped: string | null;
};

type ClipRow = { id: string; user_id: string; caption: string; idea: string | null };

async function uncheckedClips(learn: LearnSupabaseClient): Promise<ClipRow[]> {
  const out: ClipRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await learn
      .from('video_clips')
      .select('id, user_id, caption, idea')
      .is('tagged_at', null)
      .order('user_id')
      .order('cut_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the clips to tag failed: ${error.message}`);
    const rows = (data ?? []) as ClipRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** One row per clip and subject it serves. */
export function tagRows(userId: string, subjects: Map<string, string[]>): { user_id: string; clip_id: string; subject_id: string }[] {
  return [...subjects].flatMap(([clipId, ids]) => ids.map((subjectId) => ({ user_id: userId, clip_id: clipId, subject_id: subjectId })));
}

/** Tag the unchecked clips, until the batches or the time run out. */
export async function tagUntaggedClips(
  learn: LearnSupabaseClient,
  options: {
    anthropicApiKey: string;
    /** No batch is started after this. */
    deadline: number;
    /** A call still running at this point is abandoned, and its batch is tried again next run. */
    hardDeadline?: number;
    /** Batches sent this run. Unlimited when left out. */
    maxBatches?: number;
    client?: Anthropic;
    /** Called once per call made, with the person the clips are for. */
    onSpend?: (userId: string, report: SpendReport) => void;
    now?: () => Date;
    /** Stands in for reading the person's subjects, for tests. */
    subjectsFor?: (userId: string) => Promise<SubjectToTag[]>;
  },
): Promise<TagPassResult> {
  const result: TagPassResult = { checked: 0, tagged: 0, fitNothing: 0, tags: 0, failed: 0, waiting: 0, stopped: null };
  const now = options.now ?? (() => new Date());
  const clips = await uncheckedClips(learn);
  const byPerson = new Map<string, ClipRow[]>();
  for (const clip of clips) byPerson.set(clip.user_id, [...(byPerson.get(clip.user_id) ?? []), clip]);

  let sent = 0;
  const maxBatches = options.maxBatches ?? Infinity;
  people: for (const [userId, rows] of byPerson) {
    const subjects = options.subjectsFor
      ? await options.subjectsFor(userId)
      : (await loadSubjects(learn, userId)).map((subject) => ({ id: subject.id, name: subject.name, note: subject.note }));
    if (subjects.length === 0) continue;
    for (let at = 0; at < rows.length; at += TAG_BATCH) {
      if (sent >= maxBatches) break people;
      if (Date.now() >= options.deadline) {
        result.stopped = 'out of time; the next run carries on';
        break people;
      }
      sent += 1;
      const batch: ClipToTag[] = rows.slice(at, at + TAG_BATCH).map((row) => ({ id: row.id, caption: row.caption, idea: row.idea }));
      const reply = await tagClipBatch({
        subjects,
        clips: batch,
        anthropicApiKey: options.anthropicApiKey,
        client: options.client,
        onSpend: options.onSpend ? (report) => options.onSpend!(userId, report) : undefined,
        timeoutMs: options.hardDeadline !== undefined ? options.hardDeadline - Date.now() : undefined,
      });
      if (reply.outcome === 'failed') {
        result.failed += 1;
        console.error(`[clip-tags] ${userId}`, reply.detail);
        continue;
      }
      const rowsToTag = tagRows(userId, reply.subjects);
      if (rowsToTag.length > 0) {
        const { data, error } = await learn
          .from('video_clip_subjects')
          .upsert(rowsToTag, { onConflict: 'clip_id,subject_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(`Tagging the clips with their subjects failed: ${error.message}`);
        result.tags += (data ?? []).length;
      }
      const ids = batch.map((clip) => clip.id);
      const { error } = await learn.from('video_clips').update({ tagged_at: now().toISOString() }).eq('user_id', userId).in('id', ids);
      if (error) throw new Error(`Marking the clips checked failed: ${error.message}`);
      result.checked += ids.length;
      const fit = ids.filter((id) => (reply.subjects.get(id) ?? []).length > 0).length;
      result.tagged += fit;
      result.fitNothing += ids.length - fit;
    }
  }
  result.waiting = clips.length - result.checked;
  return result;
}
