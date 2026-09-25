/**
 * How much each track is asked about in Practice Flow, and which new tracks
 * lean towards the ones you engage with (plan #780).
 *
 * Every track gets a weight from what you did with it in the last four weeks:
 * questions answered push it up, and questions you moved past without
 * answering, or pushed aside with Not now, push it down. Its lessons in Learn
 * now count the same way (LEARN-LESSONS-SPEC, "How slots are shared between
 * tracks"): Got it and Work on this as an answer, Not now as a question moved
 * past. A track with no
 * history weighs 1. The mixed flow then shares its questions between tracks in
 * proportion to their weights, except that about one question in five goes to
 * the track asked about least, so the picks do not narrow to one track.
 *
 * The same weights lean the new-track offer: a theme that shares notes with
 * the theme behind a track you engage with is offered sooner, and one near a
 * track you keep skipping, or near an offer you turned down with Never, later.
 *
 * Pure, so the numbers are testable against rows written by hand. The reading
 * that feeds it is `interest-load.ts`.
 */

/** "A few weeks": how far back what you did counts. */
export const INTEREST_WINDOW_DAYS = 28;

/** The heaviest and lightest a track can weigh against one with no history. */
export const MOST_WEIGHT = 4;
export const LEAST_WEIGHT = 0.25;

/**
 * The weight of a track you answered questions from before the window and
 * none from inside it, while answering other tracks' questions.
 */
export const STOPPED_WEIGHT = 0.5;

/**
 * One question in this many goes to the track asked about least. The fifth
 * is already the re-check (`RECHECK_EVERY`), so this one lands on the second.
 */
export const EXPLORE_EVERY = 5;

/** What you did with one track's questions in the window. */
export type TrackActivity = {
  /** Questions from it you answered. */
  answered: number;
  /** Questions from it shown to you and left unanswered for the next one. */
  skipped: number;
  /** Its ideas you pushed aside with Not now. */
  pushedAside: number;
  /** Questions from it you answered, and its lessons you engaged with, before the window. */
  answeredBefore: number;
  /** Its lessons in Learn now swiped Got it or Work on this. */
  lessonsTaken?: number;
  /** Its lessons in Learn now swiped Not now. */
  lessonsPassed?: number;
  /**
   * When a question from it was last answered or a lesson from it last taken,
   * as far back as the loader reads. Unset when nothing was. What says how long
   * a dormant track has been resting (plan #1045).
   */
  lastUsed?: string;
};

export type TrackWeight = {
  weight: number;
  /** You answered questions elsewhere in the window and none from this track. */
  stopped: boolean;
};

const clamp = (value: number) => Math.min(MOST_WEIGHT, Math.max(LEAST_WEIGHT, value));

/**
 * One track's weight.
 *
 * (answered + 1) / (skipped + pushed aside + 1), held between a quarter and
 * four, so ten answers against no skips is the most a track can get and six
 * skips against none answered the least. `answeredElsewhere` is whether any
 * other track had a question answered in the window: without it, a month away
 * from Learn would read as having stopped every track at once.
 */
export function trackWeight(activity: TrackActivity, answeredElsewhere: boolean): TrackWeight {
  const engaged = engagedWith(activity);
  const passed = passedOver(activity);
  const stopped = engaged === 0 && activity.answeredBefore > 0 && passed === 0 && answeredElsewhere;
  if (stopped) return { weight: STOPPED_WEIGHT, stopped };

  return { weight: clamp((engaged + 1) / (passed + 1)), stopped };
}

/** Questions answered and lessons taken in the window. */
function engagedWith(activity: TrackActivity): number {
  return activity.answered + (activity.lessonsTaken ?? 0);
}

/** Questions and lessons moved past, and ideas pushed aside, in the window. */
function passedOver(activity: TrackActivity): number {
  return activity.skipped + activity.pushedAside + (activity.lessonsPassed ?? 0);
}

/** Every track's weight, from the activity of all of them. */
export function trackWeights(activity: Map<string, TrackActivity>): Map<string, TrackWeight> {
  const answering = [...activity].filter(([, row]) => engagedWith(row) > 0).map(([id]) => id);
  const weights = new Map<string, TrackWeight>();
  for (const [subjectId, row] of activity) {
    const elsewhere = answering.some((id) => id !== subjectId);
    weights.set(subjectId, trackWeight(row, elsewhere));
  }
  return weights;
}

const NO_ACTIVITY: TrackActivity = { answered: 0, skipped: 0, pushedAside: 0, answeredBefore: 0 };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function howOften(weight: number): string {
  if (weight === 1) return 'as often as a new one';
  if (weight > 1) {
    const times = Math.round(weight * 10) / 10;
    return `about ${times} times as often as a new one`;
  }
  return `about ${Math.round(weight * 100)}% as often as a new one`;
}

/**
 * The sentence the track's page shows about its weight.
 *
 * It names the counts the weight came from, so the page can be checked
 * against what you remember doing.
 */
export function weightReason(
  activity: TrackActivity | undefined,
  weight: TrackWeight | undefined,
): string {
  const row = activity ?? NO_ACTIVITY;
  const { weight: value, stopped } = weight ?? { weight: 1, stopped: false };
  const lead = `Practice Flow asks about this track ${howOften(value)}`;

  if (stopped) {
    return `${lead}, because in the last four weeks you answered questions from other tracks and none from this one.`;
  }

  const taken = row.lessonsTaken ?? 0;
  const passedLessons = row.lessonsPassed ?? 0;
  if (engagedWith(row) === 0 && passedOver(row) === 0) {
    return `${lead}, because you have not answered or skipped any of its questions in the last four weeks.`;
  }

  const parts = [
    `you answered ${row.answered === 0 ? 'none' : row.answered} of its questions`,
    `skipped ${row.skipped === 0 ? 'none' : row.skipped}`,
    ...(row.pushedAside > 0 ? [`pushed ${plural(row.pushedAside, 'idea', 'ideas')} aside with Not now`] : []),
    ...(taken > 0 ? [`took ${plural(taken, 'lesson', 'lessons')} in Learn now`] : []),
    ...(passedLessons > 0 ? [`passed on ${plural(passedLessons, 'lesson', 'lessons')}`] : []),
  ];
  const listed = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `${lead}, because in the last four weeks ${listed}.`;
}

/**
 * A track as the mixed flow shares questions out.
 *
 * `asked` is how many of its questions were put in front of you in the window,
 * answered or not, plus any written ahead and still waiting.
 */
export type TrackShare = {
  subjectId: string;
  weight: number;
  asked: number;
};

/** Whether this turn goes to the track asked about least. */
export function isExploreTurn(answered: number): boolean {
  return (answered + 1) % EXPLORE_EVERY === 2;
}

/**
 * The track the next question comes from, among those with something to ask.
 *
 * On an explore turn, the track asked about least. Otherwise the track
 * furthest behind its share: the lowest (asked + 1) / weight, so over a run of
 * questions each track is asked about in proportion to its weight. Ties go to
 * the heavier track and then to the id, so the same rows give the same pick.
 * A track missing from `shares` weighs 1 and has been asked nothing.
 */
export function trackToAsk(
  candidates: readonly string[],
  shares: readonly TrackShare[],
  explore: boolean,
): string | null {
  if (candidates.length === 0) return null;
  const byId = new Map(shares.map((share) => [share.subjectId, share]));
  const share = (id: string) => byId.get(id) ?? { subjectId: id, weight: 1, asked: 0 };

  const ordered = [...new Set(candidates)].map(share).sort((a, b) => {
    if (explore) {
      if (a.asked !== b.asked) return a.asked - b.asked;
    } else {
      const behindA = (a.asked + 1) / a.weight;
      const behindB = (b.asked + 1) / b.weight;
      if (behindA !== behindB) return behindA - behindB;
    }
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.subjectId.localeCompare(b.subjectId);
  });
  return ordered[0]?.subjectId ?? null;
}

/**
 * A theme that pulls new-track offers towards itself or away from itself:
 * the theme behind a track, with that track's weight, or an offer you turned
 * down, with the weight a turned-down offer carries.
 */
export type ThemeAnchor = {
  themeId: string;
  pull: number;
  notes: ReadonlySet<string>;
};

/** An offer you pressed Never on pulls like a track you keep skipping. */
export const NEVER_PULL = LEAST_WEIGHT;

/** How near two themes are: the share of their notes they have in common. */
export function nearness(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const note of a) if (b.has(note)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * How much each candidate theme's strength is multiplied by when choosing the
 * next track to offer.
 *
 * 1 + the sum over anchors of nearness × (pull − 1), held between a quarter
 * and four: a theme sharing half its notes with a track weighing 4 is offered
 * as though it were two and a half times as strong, and one far from every
 * anchor keeps its own strength. Anchors of weight 1 change nothing, so with
 * no history the offer is the strongest theme, as before.
 */
export function offerLean(
  candidates: readonly { id: string; notes: ReadonlySet<string> }[],
  anchors: readonly ThemeAnchor[],
): Map<string, number> {
  const lean = new Map<string, number>();
  for (const candidate of candidates) {
    let value = 1;
    for (const anchor of anchors) {
      if (anchor.themeId === candidate.id || anchor.pull === 1) continue;
      value += nearness(candidate.notes, anchor.notes) * (anchor.pull - 1);
    }
    lean.set(candidate.id, clamp(value));
  }
  return lean;
}
