/**
 * What the clip player decides as it plays (plan #1400). Pure, so the rules
 * are tested without a browser or a YouTube player; the player in
 * app/learn/clips/clip-stream.tsx calls these.
 */

/** A clip as the player holds it: what it plays and what it shows. Plain data, so it crosses to the browser. */
export type PlayerClip = {
  id: string;
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  caption: string;
  /** The video's title; null when the catalogue row is gone. */
  title: string | null;
  /** The channel as YouTube spells it, for display. */
  channel: string | null;
  saved: boolean;
};

/** Ask for more clips once this few are left after the one playing. */
export const REFILL_AT = 2;

/** How long a clip loaded into the player may sit without playing before the page asks for a tap. */
export const AUTOPLAY_GRACE_MS = 2500;

/** Within this many seconds of its end, a clip counts as played through. */
const END_SLACK_SECONDS = 0.75;

/** Seconds of the clip watched, from where the player is now. Never negative, never past the clip's length. */
export function watchedSeconds(clip: Pick<PlayerClip, 'startSeconds' | 'endSeconds'>, currentTime: number | null): number {
  if (currentTime === null || !Number.isFinite(currentTime)) return 0;
  const length = Math.max(0, clip.endSeconds - clip.startSeconds);
  return Math.min(length, Math.max(0, currentTime - clip.startSeconds));
}

/** True once the player has reached the clip's end, for a player that stops a moment short of it. */
export function reachedEnd(clip: Pick<PlayerClip, 'endSeconds'>, currentTime: number | null): boolean {
  return currentTime !== null && Number.isFinite(currentTime) && currentTime >= clip.endSeconds - END_SLACK_SECONDS;
}

/** Whether to fetch more: few enough left after `index`, nothing in flight, and the last fetch was not empty. */
export function shouldRefill(queueLength: number, index: number, state: { loading: boolean; exhausted: boolean }): boolean {
  if (state.loading || state.exhausted) return false;
  return queueLength - 1 - index <= REFILL_AT;
}

/** New clips added to the end of the queue, leaving out any already in it. */
export function appendClips(queue: readonly PlayerClip[], more: readonly PlayerClip[]): PlayerClip[] {
  const have = new Set(queue.map((clip) => clip.id));
  return [...queue, ...more.filter((clip) => !have.has(clip.id))];
}

/**
 * What leaving a clip writes. A clip that never started playing writes
 * nothing, since nobody saw it; one left at its end is finished; one left
 * earlier is skipped with the seconds watched. Not interested is written by
 * its own button, so leaving that way writes nothing more.
 */
export type Leave = 'next' | 'ended' | 'not-interested';
export type LeaveWrite = { kind: 'finished' | 'skipped'; watched: number } | null;

export function leaveWrite(
  clip: Pick<PlayerClip, 'startSeconds' | 'endSeconds'>,
  how: Leave,
  { shown, currentTime }: { shown: boolean; currentTime: number | null },
): LeaveWrite {
  if (!shown || how === 'not-interested') return null;
  const watched = watchedSeconds(clip, currentTime);
  if (how === 'ended' || reachedEnd(clip, currentTime)) {
    return { kind: 'finished', watched: Math.max(watched, clip.endSeconds - clip.startSeconds) };
  }
  return { kind: 'skipped', watched };
}

/** A swipe up: far enough, quick enough, and more up than sideways. */
export function isSwipeUp(dx: number, dy: number, ms: number): boolean {
  return dy <= -60 && Math.abs(dy) > Math.abs(dx) * 1.5 && ms < 800;
}
