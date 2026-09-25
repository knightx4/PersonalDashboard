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

/** An 11-character YouTube video id: letters, digits, `-` and `_`. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube link, or null for anything that is not one.
 *
 * Reads the shapes the catalogue and the readings hold: `youtube.com/watch?v=`,
 * `youtu.be/`, and the `/embed/`, `/shorts/` and `/live/` paths, on the
 * mobile, music and no-cookie hosts too. A link to a channel or a playlist has
 * no single video and gets null.
 */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = parsed.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname === '/watch') {
      id = parsed.searchParams.get('v');
    } else {
      const [, kind, rest] = parsed.pathname.split('/');
      if (kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') id = rest ?? null;
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}
