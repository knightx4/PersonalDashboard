import { INTEREST_WINDOW_DAYS, type TrackActivity, type TrackWeight } from '@/lib/learn/flow/interest';

/**
 * A resting track offered back in Learn now (plan #1045; LEARN-LESSONS-SPEC,
 * "A resting track is offered back").
 *
 * A track goes dormant when it has stopped (`trackWeight`: nothing done on it
 * in the four weeks while other tracks were used), and from then on it takes
 * no lesson slot. Two weeks after that it is offered back as one card, with
 * Pick it up, Not now and Let it rest. Each press is a `resting` row in
 * `learn.track_offers`, and this file reads those rows:
 *
 * - Pick it up: the track is not dormant for the four weeks after the press,
 *   so the chooser gives it lessons again (`pickedUpSince`). If it is still
 *   not used when they run out, it is dormant again from then, and offered two
 *   weeks after that.
 * - Not now: the track is not offered for four weeks.
 * - Let it rest: the track is not offered again until it is used again, which
 *   is a question answered or a lesson taken after the press.
 *
 * A goal's track is never offered: it does not go dormant while the goal is
 * active. Pure, so the choice is testable against rows written by hand; the
 * reads are in `resting-load.ts`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days a track has been dormant before it is offered back. */
export const RESTING_OFFER_AFTER_DAYS = 14;

/** Days Pick it up keeps a track out of dormant, and Not now holds the offer back. */
export const RESTING_HOLD_DAYS = 28;

export type RestingOutcome = 'picked_up' | 'not_now' | 'rested';

/** One press on a resting-track offer. */
export type RestingPress = { subjectId: string; outcome: RestingOutcome; happenedAt: string };

/** What the card shows. */
export type RestingOffer = {
  subjectId: string;
  name: string;
  /** When the track was last used, for "you last came back to this …". */
  lastUsed: string;
};

const at = (iso: string) => new Date(iso).getTime();

/** Tracks picked up in the four weeks before `now`: the chooser treats them as not dormant. */
export function pickedUpSince(record: readonly RestingPress[], now: Date): Set<string> {
  const since = now.getTime() - RESTING_HOLD_DAYS * DAY_MS;
  return new Set(
    record
      .filter((press) => press.outcome === 'picked_up' && at(press.happenedAt) >= since)
      .map((press) => press.subjectId),
  );
}

/**
 * When the track went dormant, or null when it is not dormant: four weeks after
 * its last use or after its latest Pick it up, whichever is later.
 */
function dormantSince(
  lastUsed: number,
  presses: readonly RestingPress[],
): number {
  const pickedUp = presses
    .filter((press) => press.outcome === 'picked_up')
    .reduce((latest, press) => Math.max(latest, at(press.happenedAt)), 0);
  return Math.max(lastUsed, pickedUp) + INTEREST_WINDOW_DAYS * DAY_MS;
}

/**
 * The resting track to offer this visit, or null.
 *
 * A track qualifies when its weight has stopped, it is not a goal's track, it
 * has been dormant for two weeks, no Not now on it is under four weeks old,
 * and no Let it rest on it is newer than its last use. Of those, the one
 * dormant longest is offered, and the name breaks a tie.
 */
export function restingTrackToOffer(input: {
  tracks: readonly { subjectId: string; name: string }[];
  activity: ReadonlyMap<string, TrackActivity>;
  weights: ReadonlyMap<string, TrackWeight>;
  goalTracks: ReadonlySet<string>;
  record: readonly RestingPress[];
  now: Date;
}): RestingOffer | null {
  const now = input.now.getTime();
  let best: { offer: RestingOffer; since: number } | null = null;

  for (const track of input.tracks) {
    if (!input.weights.get(track.subjectId)?.stopped) continue;
    if (input.goalTracks.has(track.subjectId)) continue;
    const lastUsed = input.activity.get(track.subjectId)?.lastUsed;
    if (!lastUsed) continue;

    const presses = input.record.filter((press) => press.subjectId === track.subjectId);
    const rested = presses.some(
      (press) => press.outcome === 'rested' && at(press.happenedAt) >= at(lastUsed),
    );
    const heldBack = presses.some(
      (press) =>
        press.outcome === 'not_now' && at(press.happenedAt) > now - RESTING_HOLD_DAYS * DAY_MS,
    );
    if (rested || heldBack) continue;

    const since = dormantSince(at(lastUsed), presses);
    if (now < since + RESTING_OFFER_AFTER_DAYS * DAY_MS) continue;

    if (
      !best ||
      since < best.since ||
      (since === best.since && track.name.localeCompare(best.offer.name) < 0)
    ) {
      best = { offer: { subjectId: track.subjectId, name: track.name, lastUsed }, since };
    }
  }
  return best?.offer ?? null;
}

/** Whole weeks from `lastUsed` to `now`, for the card. */
export function weeksResting(lastUsed: string, now: Date): number {
  return Math.floor((now.getTime() - at(lastUsed)) / (7 * DAY_MS));
}
