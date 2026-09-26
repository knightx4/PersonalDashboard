import 'server-only';

import { isAimDepth } from '@/lib/learn/aims';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { StartedTrackView, SuggestedTrackView } from './payload';

type JobsClient = Awaited<ReturnType<typeof import('@/lib/jobs/auth/server').createClient>>;

type TrackRow = {
  id: string;
  name: string;
  about: string | null;
  depth: string;
  why: string;
  status: string;
  aim_id: string | null;
};

/**
 * The Career goals page's learning tracks: suggestions still waiting on an
 * answer, newest first, and the ones started, with their Learn track and how
 * many units it has. Throws when the suggestions cannot be read; a failed read
 * on the Learn side leaves the started tracks without links.
 */
export async function loadLearningTracks(
  jobs: JobsClient,
  learn: LearnSupabaseClient,
  userId: string,
): Promise<{ suggested: SuggestedTrackView[]; started: StartedTrackView[] }> {
  const { data, error } = await jobs
    .from('learning_tracks')
    .select('id, name, about, depth, why, status, aim_id')
    .eq('user_id', userId)
    .in('status', ['proposed', 'started'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading the learning tracks failed: ${error.message}`);
  const rows = (data ?? []) as TrackRow[];

  const view = (row: TrackRow): SuggestedTrackView => ({
    id: row.id,
    name: row.name,
    about: row.about,
    depth: isAimDepth(row.depth) ? row.depth : 'familiar',
    why: row.why,
  });

  const startedRows = rows.filter((row) => row.status === 'started');
  const aimIds = startedRows.map((row) => row.aim_id).filter((id): id is string => id !== null);

  const aims = new Map<string, { subjectId: string | null; archived: boolean }>();
  const units = new Map<string, number>();
  let learnRead = false;
  if (aimIds.length > 0) {
    try {
      const { data: aimRows, error: aimError } = await learn
        .from('aims')
        .select('id, subject_id, archived_at')
        .in('id', aimIds);
      if (aimError) throw aimError;
      for (const aim of (aimRows ?? []) as { id: string; subject_id: string | null; archived_at: string | null }[]) {
        aims.set(aim.id, { subjectId: aim.subject_id, archived: aim.archived_at !== null });
      }
      const subjectIds = [...aims.values()].map((aim) => aim.subjectId).filter((id): id is string => id !== null);
      if (subjectIds.length > 0) {
        const { data: unitRows, error: unitError } = await learn
          .from('curriculum_units')
          .select('subject_id')
          .in('subject_id', subjectIds);
        if (unitError) throw unitError;
        for (const unit of (unitRows ?? []) as { subject_id: string }[]) {
          units.set(unit.subject_id, (units.get(unit.subject_id) ?? 0) + 1);
        }
      }
      learnRead = true;
    } catch (learnError) {
      console.error('[jobs learning tracks] learn read', learnError);
    }
  }

  return {
    suggested: rows.filter((row) => row.status === 'proposed').map(view),
    started: startedRows.map((row) => {
      const aim = row.aim_id ? aims.get(row.aim_id) : undefined;
      const subjectId = aim?.subjectId ?? null;
      return {
        ...view(row),
        subjectId,
        units: subjectId ? (units.get(subjectId) ?? 0) : 0,
        // Only said when Learn was read and the goal is archived or missing.
        gone: learnRead && (!aim || aim.archived),
      };
    }),
  };
}
