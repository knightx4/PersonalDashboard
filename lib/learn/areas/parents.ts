import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Attaching topics and ideas to their parents (plan #2016.2), as a stage of
 * the daily embedding run.
 *
 * The work is learn.attach_topic_parents() (migration 0128): each Level 4
 * topic without a parent gets its nearest Level 3 topic, and each idea that
 * has none, was edited since, or is older than the newest topic gets its
 * nearest Level 4 topic when the match is at least `IDEA_STRONG_MATCH`, else
 * its nearest Level 3 one. All of it reads stored vectors; no model is called.
 *
 * The topics go a slice at a time, since a call over a thousand of them runs
 * for most of a minute. A run that stops on its deadline leaves the rest
 * without a parent, which is how the next run finds them.
 */

/** Cosine similarity at which an idea's nearest Level 4 topic is its parent. */
export const IDEA_STRONG_MATCH = 0.55;

/** Level 4 topics per call. */
export const TOPICS_PER_CALL = 400;

export type AttachParentsResult = {
  topics: number;
  ideas: number;
  calls: number;
  /** True when the deadline stopped the run with topics still unattached. */
  stoppedEarly: boolean;
};

type Attached = { topics_attached: number; ideas_attached: number };

export async function attachTopicParents(
  learn: LearnSupabaseClient,
  options: { deadline?: number; perCall?: number } = {},
): Promise<AttachParentsResult> {
  const perCall = options.perCall ?? TOPICS_PER_CALL;
  const result: AttachParentsResult = { topics: 0, ideas: 0, calls: 0, stoppedEarly: false };
  for (;;) {
    const { data, error } = await learn
      .rpc('attach_topic_parents', { p_threshold: IDEA_STRONG_MATCH, p_topic_limit: perCall })
      .single();
    if (error) throw new Error(`Attaching topics to their parents failed: ${error.message}`);
    const row = data as Attached;
    result.calls += 1;
    result.topics += row.topics_attached;
    result.ideas += row.ideas_attached;
    // A short slice means none are left; ideas are all done in the first call.
    if (row.topics_attached < perCall) return result;
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      result.stoppedEarly = true;
      return result;
    }
  }
}
