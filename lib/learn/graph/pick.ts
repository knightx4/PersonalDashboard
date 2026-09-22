import { isExploreTurn, trackToAsk, type TrackShare } from '@/lib/learn/flow/interest';
import { claimToRecheck, isRecheckTurn, type SettledConcept } from './recheck';
import { rankReady, type ReadyConcept } from './ready';

/**
 * The single claim a five-minute session asks about.
 *
 * `rankReady` puts everything that could be started next in order, for a
 * screen that shows eight of them. This takes the same rows and answers a
 * narrower question: which one thing to ask about when the person is not
 * choosing. Pure, so the order is testable against rows written by hand, and
 * the reading that feeds it is `loadReadyAndSettled` in `load.ts`.
 */

/** Why there is nothing to ask about. The two cases read differently. */
export type NothingToAsk = 'no-subjects' | 'all-settled';

export type OneToAsk =
  | { kind: 'ask'; row: ReadyConcept }
  | { kind: 'recheck'; row: SettledConcept }
  | { kind: 'nothing'; because: NothingToAsk };

export type PickInput = {
  /** What could be started next, in any order. */
  ready: ReadyConcept[];
  /** What has been answered about already, in any order. */
  settled: SettledConcept[];
  subjectCount: number;
  /** How many questions have been answered, across every subject. */
  answered: number;
  now: Date;
  /**
   * How the mixed flow shares questions between tracks (plan #780). When set,
   * the track is chosen first by weight and the claim ranked inside it; when
   * unset, the ready rows are ranked across every track at once, which is
   * what a flow focused on one track and the older callers want.
   */
  shares?: readonly TrackShare[];
};

/**
 * The one claim, or which of the two empty cases applies.
 *
 * Every fifth question goes back to the settled claim you were asked about
 * longest ago, and every other one is about the frontier. A re-check turn with
 * nothing old enough on it falls through to an ordinary question rather than
 * asking about something settled last week. With `shares`, an ordinary
 * question comes from the track `trackToAsk` chooses (plan #780); re-checks
 * are not shared out, since they go to whatever was settled longest ago.
 *
 * Ranked here rather than trusted from the caller, so a list read in any order
 * gives the same question. `subjectCount` is what separates the two empty
 * cases: with no subjects there is nothing to ask about because nothing has
 * been named yet, and with subjects but no ready rows every claim in them is
 * settled. A subject whose concepts have not been written yet has nothing left
 * to ask about either, and reads as settled.
 */
export function pickOneToAsk(input: PickInput): OneToAsk {
  if (isRecheckTurn(input.answered)) {
    const old = claimToRecheck(input.settled, input.now);
    if (old) return { kind: 'recheck', row: old };
  }

  const [row] = rankReady(readyInChosenTrack(input), 1);
  if (row) return { kind: 'ask', row };
  return { kind: 'nothing', because: input.subjectCount === 0 ? 'no-subjects' : 'all-settled' };
}

/** The ready rows of the track this turn goes to, or all of them without shares. */
function readyInChosenTrack(input: PickInput): ReadyConcept[] {
  if (!input.shares) return input.ready;
  const track = trackToAsk(
    input.ready.map((row) => row.subjectId),
    input.shares,
    isExploreTurn(input.answered),
  );
  return input.ready.filter((row) => row.subjectId === track);
}

/** A pick that found something to ask about. */
export type PickedToAsk = Exclude<OneToAsk, { kind: 'nothing' }>;

/**
 * The next few claims Practice Flow writes questions for ahead of time.
 *
 * The same pick run `count` times, each time as though the questions before it
 * had been answered: a claim picked once is taken out of the rows, and the
 * count of answers moves on by one, so the fifth-question re-check lands where
 * it would have if each had been picked live. `queued` is the claims already
 * written ahead and not yet shown. They are left out too, and they count
 * towards how far along the re-check cadence the new picks sit.
 *
 * What an answer will do to a claim cannot be known here, so these are the
 * picks as things stand. The flow checks each claim's state again before
 * showing its question and throws the question away if it has moved.
 */
export function pickAhead(input: PickInput, count: number, queued: readonly string[]): PickedToAsk[] {
  const taken = new Set(queued);
  const picks: PickedToAsk[] = [];
  // Each pick counts as asked, so the next one is shared out after it.
  const shares = input.shares?.map((share) => ({ ...share }));

  while (picks.length < count) {
    const picked = pickOneToAsk({
      ...input,
      shares,
      ready: input.ready.filter((row) => !taken.has(row.concept.id)),
      settled: input.settled.filter((row) => !taken.has(row.concept.id)),
      answered: input.answered + queued.length + picks.length,
    });
    if (picked.kind === 'nothing') break;
    taken.add(picked.row.concept.id);
    picks.push(picked);
    const share = shares?.find((row) => row.subjectId === picked.row.subjectId);
    if (share) share.asked += 1;
    else shares?.push({ subjectId: picked.row.subjectId, weight: 1, asked: 1 });
  }

  return picks;
}
