/**
 * The counts beside a subject's player (plan #1697), from its clips' rows.
 * A clip marked not interested never plays again, so it is not counted.
 */

export type SubjectClipCounts = {
  /** Cut from videos in Watch later. */
  watchLater: number;
  /** Cut from channels you follow. */
  channels: number;
  /** Not played yet. */
  unplayed: number;
};

export type SubjectClipRow = {
  came_from: string;
  shown_at: string | null;
  not_interested_at: string | null;
};

export function countSubjectClips(rows: readonly SubjectClipRow[]): SubjectClipCounts {
  const counts: SubjectClipCounts = { watchLater: 0, channels: 0, unplayed: 0 };
  for (const row of rows) {
    if (row.not_interested_at) continue;
    if (row.came_from === 'playlist') counts.watchLater += 1;
    else counts.channels += 1;
    if (!row.shown_at) counts.unplayed += 1;
  }
  return counts;
}
