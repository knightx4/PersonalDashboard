import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { countSubjectClips, type SubjectClipCounts, type SubjectClipRow } from './subject-counts';

/**
 * What a subject's Clips page shows beside the player (plan #1697): how many
 * clips serve the subject, from each source, and how many have not played.
 * Read through learn.video_clip_subjects, the same join the player reads, so
 * the counts and the player agree.
 */

/** More clips than one subject will hold for a long while; the counts stop here. */
const MOST = 2000;

export async function loadSubjectClipCounts(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SubjectClipCounts> {
  const { data, error } = await learn
    .from('video_clips')
    .select('came_from, shown_at, not_interested_at, video_clip_subjects!inner(subject_id)')
    .eq('user_id', userId)
    .eq('video_clip_subjects.subject_id', subjectId)
    .limit(MOST);
  if (error) throw new Error(`Reading this subject's clips failed: ${error.message}`);
  return countSubjectClips((data ?? []) as unknown as SubjectClipRow[]);
}
