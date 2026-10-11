/**
 * What each of the runner's four slots is doing.
 *
 * The runner keeps up to `OVERNIGHT_AT_ONCE` feature sessions going, one per
 * module, and one goals run beside them. The runner card draws one Dash for
 * each of those four, and this file says which of three things each Dash is
 * doing so the card has nothing to work out.
 *
 * Pure, and not `server-only`: the card is drawn in the browser from rows the
 * page already loaded, the same split `overnight.ts` makes.
 *
 * Which session takes which slot is the one non-obvious part. A function that
 * is handed only the sessions going now cannot keep a Dash on its row when
 * another one finishes: with sessions A, B and C going, and A ending, B would
 * slide up to slot 1. So it is handed the night's feature sessions, ended ones
 * too, and replays them: each takes the lowest free slot at the moment it was
 * fired and holds it until it ends. The same input always gives the same
 * answer, and nothing has to be remembered between renders.
 */
import { elapsedSince } from './elapsed';
import { OVERNIGHT_AT_ONCE, overnightStanding, type OvernightRun } from './overnight';

/** A feature session the runner (or a hand) fired, going or over. */
export type SlotSession = {
  /** The run's id, which breaks a tie between two fired at the same instant. */
  id: string;
  firedAt: string;
  /** When it ended, or null while it is going. */
  endedAt: string | null;
  /**
   * The step it was sent at, or null when the fire left no record of one.
   * `ref` is how the plan writes it, "#1700.2" for a step under a feature.
   */
  step: { number: number; title: string; ref?: string } | null;
  /** The workspace the step is in, as the plan names it. */
  module: string | null;
  /** What the run last did, one short phrase, or null when nothing is known. */
  doing: string | null;
};

/** The goals run, when one is going. */
export type SlotGoalRun = {
  startedAt: string;
  /** What it is working on, for example the goal step's title. */
  title: string | null;
  doing: string | null;
};

export type SlotWork = {
  /** The step number, null for a goals run or a fire with no record. */
  step: number | null;
  /** How the plan writes it ("#1700.2"), null where `step` is. */
  ref: string | null;
  title: string | null;
  module: string | null;
  doing: string | null;
  /** When it started, so the card can keep the clock running. */
  since: string;
  /** How long it has been going, in the app's coarse words. Null before mount. */
  elapsed: string | null;
};

export type RunnerSlot =
  | { slot: SlotId; label: string; state: 'idle' }
  | { slot: SlotId; label: string; state: 'working'; work: SlotWork }
  | { slot: SlotId; label: string; state: 'asleep'; reason: string };

export type SlotId = 'feature-1' | 'feature-2' | 'feature-3' | 'goals';

export type RunnerSlotsInput = {
  run: OvernightRun | null;
  /** The night's feature sessions, ended ones included, in any order. */
  sessions: readonly SlotSession[];
  goalRun: SlotGoalRun | null;
  /** Why the goals half is waiting, from `goalsNightNote`. Null when it said nothing. */
  goalsReason?: string | null;
  now: number;
};

/** Said when the tick has not yet written a reason. */
export const SLOT_ASLEEP_DEFAULT = 'Waiting for the next check.';

const FEATURE_SLOTS: readonly SlotId[] = ['feature-1', 'feature-2', 'feature-3'];
const LABELS: Record<SlotId, string> = {
  'feature-1': 'Feature 1',
  'feature-2': 'Feature 2',
  'feature-3': 'Feature 3',
  goals: 'Goals',
};

function at(stamp: string): number {
  const t = new Date(stamp).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The slot each session held, by session id.
 *
 * Replays fires and ends in time order, an end before a fire at the same
 * instant. A session fired when all three slots are taken (one fired by hand
 * beside the night's) has no slot and is left out.
 */
export function assignSlots(sessions: readonly SlotSession[]): Map<string, number> {
  type Event = { time: number; fire: boolean; session: SlotSession };
  const events: Event[] = [];
  for (const session of sessions) {
    events.push({ time: at(session.firedAt), fire: true, session });
    if (session.endedAt !== null) {
      events.push({ time: at(session.endedAt), fire: false, session });
    }
  }
  events.sort(
    (a, b) =>
      a.time - b.time ||
      Number(a.fire) - Number(b.fire) ||
      a.session.firedAt.localeCompare(b.session.firedAt) ||
      a.session.id.localeCompare(b.session.id),
  );

  const held: Array<string | null> = Array.from({ length: OVERNIGHT_AT_ONCE }, () => null);
  const assigned = new Map<string, number>();
  for (const event of events) {
    if (event.fire) {
      const free = held.indexOf(null);
      if (free === -1) continue;
      held[free] = event.session.id;
      assigned.set(event.session.id, free);
    } else {
      const index = assigned.get(event.session.id);
      if (index !== undefined && held[index] === event.session.id) held[index] = null;
    }
  }
  return assigned;
}

function workOf(
  src: {
    firedAt: string;
    step: SlotSession['step'];
    title?: string | null;
    module: string | null;
    doing: string | null;
  },
  now: number,
): SlotWork {
  return {
    step: src.step?.number ?? null,
    ref: src.step ? (src.step.ref ?? `#${src.step.number}`) : null,
    title: src.step?.title ?? src.title ?? null,
    module: src.module,
    doing: src.doing,
    since: src.firedAt,
    // 0 is the clock's pre-mount value: say nothing rather than "just now".
    elapsed: now === 0 ? null : elapsedSince(src.firedAt, now),
  };
}

/**
 * The four slots, feature 1 to 3 and then goals.
 *
 * Off (no row, or a night that ended) is idle all round. On or held, a slot
 * with a run going is working: a held runner starts nothing new, but what was
 * already building carries on, and a Dash that slept through it would be
 * wrong. A slot with nothing going is asleep with the tick's reason when the
 * runner is on, and idle when it is held.
 */
export function runnerSlots(input: RunnerSlotsInput): RunnerSlot[] {
  const { run, sessions, goalRun, now } = input;
  const standing = overnightStanding(run);
  const on = standing === 'running' || standing === 'paused';
  const sleeps = standing === 'running';

  const assigned = assignSlots(sessions);
  const going = new Map<number, SlotSession>();
  for (const session of sessions) {
    const index = assigned.get(session.id);
    if (index !== undefined && session.endedAt === null) going.set(index, session);
  }

  const reason = run?.lastTickNote?.trim() || SLOT_ASLEEP_DEFAULT;

  const slots: RunnerSlot[] = FEATURE_SLOTS.map((slot, index) => {
    const label = LABELS[slot];
    const session = going.get(index);
    if (!on) return { slot, label, state: 'idle' };
    if (session) return { slot, label, state: 'working', work: workOf(session, now) };
    return sleeps ? { slot, label, state: 'asleep', reason } : { slot, label, state: 'idle' };
  });

  const label = LABELS.goals;
  if (!on) {
    slots.push({ slot: 'goals', label, state: 'idle' });
  } else if (goalRun) {
    slots.push({
      slot: 'goals',
      label,
      state: 'working',
      work: workOf(
        {
          firedAt: goalRun.startedAt,
          step: null,
          title: goalRun.title,
          module: 'goals',
          doing: goalRun.doing,
        },
        now,
      ),
    });
  } else if (sleeps) {
    slots.push({
      slot: 'goals',
      label,
      state: 'asleep',
      reason: input.goalsReason?.trim() || SLOT_ASLEEP_DEFAULT,
    });
  } else {
    slots.push({ slot: 'goals', label, state: 'idle' });
  }
  return slots;
}
