/**
 * Times as the library pages write them. Pure, so the edge cases are tested.
 */

/** 75 → `1:15`, 3725 → `1:02:05`. */
export function clockTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A video's length for a list row, or nothing when YouTube gave none. */
export function durationLabel(seconds: number | null): string | null {
  return seconds === null ? null : clockTime(seconds);
}

/**
 * The YouTube embed for one span of a video. `start` and `end` are whole
 * seconds, which is what the player takes. The privacy-enhanced host, so an
 * embedded clip sets no YouTube cookie until it is played.
 */
export function embedUrl(videoId: string, start: number | null, end: number | null = null): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  if (start !== null && start > 0) url.searchParams.set('start', String(Math.floor(start)));
  if (end !== null && (start === null || end > start)) url.searchParams.set('end', String(Math.ceil(end)));
  url.searchParams.set('rel', '0');
  return url.toString();
}

/** A watch link that opens at a time. */
export function watchAt(videoId: string, start: number): string {
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', videoId);
  if (start > 0) url.searchParams.set('t', `${Math.floor(start)}s`);
  return url.toString();
}
