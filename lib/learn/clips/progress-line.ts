/**
 * When the YouTube library run next fires, which is when the next videos are
 * cut into clips. The schedule is pg_cron's, at 53 minutes past 01:00, 07:00,
 * 13:00 and 19:00 UTC (supabase/migrations/0101_youtube_library_tick_cron.sql);
 * change both together.
 */
export const LIBRARY_RUN_HOURS_UTC = [1, 7, 13, 19] as const;
export const LIBRARY_RUN_MINUTE = 53;

export function nextLibraryRun(now: Date): Date {
  for (let day = 0; day < 2; day++) {
    for (const hour of LIBRARY_RUN_HOURS_UTC) {
      const at = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, hour, LIBRARY_RUN_MINUTE),
      );
      if (at.getTime() > now.getTime()) return at;
    }
  }
  throw new Error('unreachable: a run falls within two days');
}

/** "in 40 minutes", "in about 3 hours": how far off the next run is. */
export function untilLabel(at: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * The status line under the Videos header. Says what is cut, what is left and
 * when the next batch comes, and stops talking about the next run once
 * everything is cut.
 */
export function clipProgressLine(
  progress: {
    playlist: { cut: number; total: number };
    channel: { cut: number; total: number };
    clips: number;
    scored: number;
    nextRunAt: Date;
  },
  now: Date,
): string {
  const { playlist, channel, clips, scored } = progress;
  const parts = [`Clips: ${playlist.cut} of ${playlist.total} of your videos cut`];
  if (channel.total > 0) parts.push(`${channel.cut} of ${channel.total} from channels Learn follows`);
  const made = clips === 0 ? 'no clips yet' : `${clips} clip${clips === 1 ? '' : 's'} ready`;
  parts.push(clips > 0 && scored < clips ? `${made}, ${scored} ranked` : made);
  const left = playlist.total - playlist.cut + (channel.total - channel.cut);
  if (left > 0) parts.push(`next batch ${untilLabel(progress.nextRunAt, now)}`);
  return parts.join(' · ');
}
