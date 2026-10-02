/**
 * Choosing what the clip stream plays next, as pure functions (plan #1399).
 *
 * lib/learn/clips/next.ts reads the clips and the person's history from the
 * database and hands them here; nothing in this file touches a client, so the
 * rules are tested with fixture clips (next.test.ts).
 *
 * The order, from the outside in:
 *
 *   1. A clip marked not interested never comes back. A clip already shown
 *      comes back only if it was skipped, and only once two weeks have passed
 *      since it was skipped and since it was last shown. Those returning clips
 *      play after every unseen one, so they fill in rather than crowd out.
 *   2. Playlist clips before channel clips (#1396 answered B).
 *   3. Scored clips before clips Jev has not scored yet. An unscored clip is
 *      still offered, after the scored ones, so the stream does not run dry
 *      while scoring catches up.
 *   4. Within that, the score Jev gave (1 to 100) with the person's own
 *      filings applied on top: Jev reads no examples, so skips and saves are a
 *      rule here, the way their filings override the video judge.
 *
 * Then at most two clips from one video in a session, and no two clips of the
 * same video back to back where another clip of the same rank tier can go
 * between them.
 */

/** A clip as the picker sees it. Times are ISO strings, as supabase-js returns them. */
export type RankableClip = {
  id: string;
  videoId: string;
  cameFrom: 'playlist' | 'channel';
  score: number | null;
  /** Who made the video: the catalogue item's author. Null when unknown, which gives no channel signal. */
  channel: string | null;
  /** The track it serves (subject_id), or the name the cutter wrote in `serves`. Null when neither. */
  theme: string | null;
  shownAt: string | null;
  skippedAt: string | null;
  notInterestedAt: string | null;
};

/** One past clip the person reacted to, read for its channel and theme. */
export type ClipReaction = {
  channel: string | null;
  theme: string | null;
  shownAt: string | null;
  watchedSeconds: number | null;
  skippedAt: string | null;
  finishedAt: string | null;
  savedAt: string | null;
};

/**
 * A skip counts against a clip's channel and theme only when it came in the
 * first few seconds: under five seconds watched means the person refused it on
 * sight, while a skip at forty seconds into a sixty-second clip is mostly
 * "got the point". Five is a judgement; change it here.
 */
export const EARLY_SKIP_SECONDS = 5;

/** A skipped clip may come back once this long has passed since it was skipped and last shown. */
export const SKIP_RETURN_MS = 14 * 24 * 60 * 60 * 1000;

/** The most clips one video contributes to a session. */
export const MAX_PER_VIDEO = 2;

/** Points off a clip's 1-100 score for each early skip on its channel or theme. */
export const EARLY_SKIP_PENALTY = 6;
/** Points on for each clip of its channel or theme finished or saved. */
export const LIKED_BONUS = 4;
/** The most the filings move a clip, either way, per channel and per theme. */
export const FILING_CAP = 24;
/** Points on for a clip whose track came up in a Learn now card in the last few days. */
export const RECENT_CARD_BONUS = 5;

export type Lean = { channel: Map<string, number>; theme: Map<string, number> };

function seconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

/** Whether a reaction is a skip in the first few seconds. */
export function isEarlySkip(r: ClipReaction): boolean {
  if (!r.skippedAt) return false;
  const watched = r.watchedSeconds ?? seconds(r.shownAt, r.skippedAt);
  return watched !== null && watched < EARLY_SKIP_SECONDS;
}

/** Whether a reaction counts for its channel and theme: finished or saved. */
export function isLiked(r: ClipReaction): boolean {
  return Boolean(r.finishedAt || r.savedAt);
}

/**
 * How far the person's filings move clips of each channel and theme, in score
 * points, capped at FILING_CAP either way. A clip that was both skipped early
 * and saved (saved later, say) counts only as liked.
 */
export function leanFrom(reactions: readonly ClipReaction[]): Lean {
  const lean: Lean = { channel: new Map(), theme: new Map() };
  const add = (map: Map<string, number>, key: string | null, delta: number) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + delta);
  };
  for (const r of reactions) {
    const delta = isLiked(r) ? LIKED_BONUS : isEarlySkip(r) ? -EARLY_SKIP_PENALTY : 0;
    if (delta === 0) continue;
    add(lean.channel, r.channel, delta);
    add(lean.theme, r.theme, delta);
  }
  for (const map of [lean.channel, lean.theme]) {
    for (const [key, value] of map) map.set(key, Math.max(-FILING_CAP, Math.min(FILING_CAP, value)));
  }
  return lean;
}

/**
 * Whether a clip may play: never if not interested; if unseen, yes; if shown,
 * only when it was skipped and two weeks have passed since both the skip and
 * the last showing.
 */
export function eligibility(clip: RankableClip, now: number): 'unseen' | 'returning' | null {
  if (clip.notInterestedAt) return null;
  if (!clip.shownAt) return 'unseen';
  if (!clip.skippedAt) return null;
  const last = Math.max(Date.parse(clip.shownAt), Date.parse(clip.skippedAt));
  return now - last >= SKIP_RETURN_MS ? 'returning' : null;
}

/** The score the picker ranks by: Jev's, moved by the filings and a recent Learn now card. Null stays null. */
export function adjustedScore(clip: RankableClip, lean: Lean, recentThemes: ReadonlySet<string>): number | null {
  if (clip.score === null) return null;
  let score = clip.score;
  if (clip.channel) score += lean.channel.get(clip.channel) ?? 0;
  if (clip.theme) {
    score += lean.theme.get(clip.theme) ?? 0;
    if (recentThemes.has(clip.theme)) score += RECENT_CARD_BONUS;
  }
  return score;
}

export type PickOptions = {
  /** How many to return. */
  limit: number;
  /** Milliseconds since the epoch; tests pass a fixed one. */
  now: number;
  /** The person's past reactions. */
  reactions?: readonly ClipReaction[];
  /** Tracks (themes) that came up in a recent Learn now card. */
  recentThemes?: ReadonlySet<string>;
  /** Clips already played per video this session, counted against MAX_PER_VIDEO. */
  playedThisSession?: ReadonlyMap<string, number>;
  /** Clips to leave out, such as ones already queued on the phone. */
  excludeIds?: ReadonlySet<string>;
};

type Ranked<T> = { clip: T; tier: number; score: number | null };

/** The rank tier: lower plays first. Returning, then channel, then unscored each push a clip back. */
function tierOf(clip: RankableClip, kind: 'unseen' | 'returning'): number {
  return (kind === 'returning' ? 4 : 0) + (clip.cameFrom === 'channel' ? 2 : 0) + (clip.score === null ? 1 : 0);
}

/** The clips to play next, in order. */
export function pickNextClips<T extends RankableClip>(clips: readonly T[], options: PickOptions): T[] {
  const lean = leanFrom(options.reactions ?? []);
  const recent = options.recentThemes ?? new Set<string>();
  const exclude = options.excludeIds ?? new Set<string>();

  const ranked: Ranked<T>[] = [];
  for (const clip of clips) {
    if (exclude.has(clip.id)) continue;
    const kind = eligibility(clip, options.now);
    if (!kind) continue;
    ranked.push({ clip, tier: tierOf(clip, kind), score: adjustedScore(clip, lean, recent) });
  }
  ranked.sort((a, b) => a.tier - b.tier || (b.score ?? 0) - (a.score ?? 0) || a.clip.id.localeCompare(b.clip.id));

  const perVideo = new Map(options.playedThisSession ?? []);
  const capped = ranked.filter((r) => {
    const n = perVideo.get(r.clip.videoId) ?? 0;
    if (n >= MAX_PER_VIDEO) return false;
    perVideo.set(r.clip.videoId, n + 1);
    return true;
  });

  // Spread: take the best remaining clip, but where it is the same video as
  // the one just picked, take the next clip of the same tier instead if there
  // is one. Never reaches into a later tier, so playlist stays before channel.
  const out: T[] = [];
  const pool = [...capped];
  while (out.length < options.limit && pool.length > 0) {
    const last = out[out.length - 1];
    let index = 0;
    if (last && pool[0].clip.videoId === last.videoId) {
      const other = pool.findIndex((r) => r.tier === pool[0].tier && r.clip.videoId !== last.videoId);
      if (other > 0) index = other;
    }
    out.push(pool.splice(index, 1)[0].clip);
  }
  return out;
}
