import type { LessonTopUpSummary } from '@/lib/learn/lessons/top-up';
import type { CardToWrite, WriteResult } from './write-card';

/**
 * Keeping Learn now stocked (LEARN-NOW-SPEC, "How cards are made"; plan #807).
 *
 * For one person: count the ready cards, and while there are fewer than
 * `READY_TARGET`, write the picked rows into cards, oldest first. When there
 * are not enough picked rows left to reach the target, run the picking pass
 * for a few more targets first. Each write either makes a card ready or drops
 * the pick, so a run of drops is made up from the next picks.
 *
 * Two callers. The hourly tick tops up anyone below the target. After a
 * response on the feed page, the top-up runs only once fewer than `READY_LOW`
 * are ready, so reading a card does not set off a model call every time, and
 * then writes `READY_BATCH` at once.
 *
 * Everything outside is a port, so the arithmetic is tested without a
 * database, a model or Wikipedia; `inngest/learn/feed-top-up.ts` supplies the
 * real ones.
 */

/** Ready cards kept per person. */
export const READY_TARGET = 20;

/**
 * Below this many ready cards, a response on the feed page starts a top-up:
 * seven or fewer ready is what note 832dd774 asked for, where ten had left
 * too long a stretch with nothing new.
 */
export const READY_LOW = 8;

/** Cards a top-up after a response writes, on top of those still ready (note 832dd774). */
export const READY_BATCH = 15;

/**
 * Picks one target yields, for working out how many targets to draw. The
 * naming call names two or three sections and some of those are not on
 * Wikipedia, so two is the planning figure.
 */
export const PICKS_PER_TARGET = 2;

/**
 * Picks that end up dropped by the writer, as a share. Drawn for on top of
 * what is short, so one round of picking usually covers the gap.
 */
export const DROP_ALLOWANCE = 0.25;

/** The most targets drawn in one round of picking. */
export const MAX_TARGETS_PER_ROUND = 6;

/** The most rounds of picking in one top-up. */
export const MAX_PICK_ROUNDS = 3;

/** Cards written at once. Each is one model call. */
export const WRITE_CONCURRENCY = 4;

/**
 * Picking is not started with less than this left before the deadline, since
 * the picks would have no time left to be written into cards.
 */
export const PICK_RESERVE_MS = 60_000;

/**
 * What to do next, given the ready cards and the picked rows waiting.
 *
 * `write`: picked rows to write now, no more than the target is short by.
 * `draw`: targets to pick for, when the picked rows cannot cover the shortfall
 * even if none of them is dropped, with the drop allowance on top.
 */
export function planTopUp(input: { ready: number; picked: number; target: number }): {
  write: number;
  draw: number;
} {
  const short = Math.max(0, input.target - input.ready);
  const write = Math.min(short, Math.max(0, input.picked));
  const uncovered = short - write;
  if (uncovered === 0) return { write, draw: 0 };
  const draw = Math.ceil((uncovered * (1 + DROP_ALLOWANCE)) / PICKS_PER_TARGET);
  return { write, draw: Math.min(Math.max(draw, 1), MAX_TARGETS_PER_ROUND) };
}

export type TopUpPorts = {
  countReady(userId: string): Promise<number>;
  /** Picked rows waiting to be written, oldest first, at most `limit`. */
  loadPicked(userId: string, limit: number): Promise<CardToWrite[]>;
  /** Run the picking pass for this many targets; returns how many rows it picked. */
  pick(userId: string, targets: number, deadline: number): Promise<number>;
  /** Write one card and store the outcome on its row. */
  write(userId: string, card: CardToWrite): Promise<WriteResult>;
  /** Milliseconds; nothing new is started once this passes the deadline. */
  now(): number;
};

export type TopUpSummary = {
  userId: string;
  readyBefore: number;
  readyAfter: number;
  /** Set when the person already had enough ready cards and nothing ran. */
  skipped: boolean;
  written: number;
  dropped: { article: string; section: string | null; reason: string }[];
  /** Rows the call could not be made for; left picked for a later run. */
  failed: string[];
  pickRounds: number;
  picked: number;
  /** Why the run stopped short of the target, when it did. */
  stopped: 'deadline' | 'nothing-to-pick' | 'pick-rounds' | 'no-progress' | null;
  /** The lessons written before the section cards (plan #978), when that ran. */
  lessons?: LessonTopUpSummary;
};

export async function runTopUpFor(
  ports: TopUpPorts,
  options: {
    userId: string;
    /** Run only when fewer than this many are ready. */
    threshold: number;
    target?: number;
    deadline: number;
  },
): Promise<TopUpSummary> {
  const { userId, deadline } = options;
  const target = options.target ?? READY_TARGET;
  const readyBefore = await ports.countReady(userId);
  const summary: TopUpSummary = {
    userId,
    readyBefore,
    readyAfter: readyBefore,
    skipped: readyBefore >= options.threshold,
    written: 0,
    dropped: [],
    failed: [],
    pickRounds: 0,
    picked: 0,
    stopped: null,
  };
  if (summary.skipped) return summary;

  // Rows whose call failed this run. They stay picked for a later run, and are
  // not offered again in this one, so a model outage cannot loop to the deadline.
  const failedIds = new Set<string>();

  while (summary.readyAfter < target) {
    if (ports.now() >= deadline) {
      summary.stopped = 'deadline';
      break;
    }

    const short = target - summary.readyAfter;
    const waiting = (await ports.loadPicked(userId, short + failedIds.size + WRITE_CONCURRENCY)).filter(
      (card) => !failedIds.has(card.id),
    );
    const plan = planTopUp({ ready: summary.readyAfter, picked: waiting.length, target });

    if (plan.write > 0) {
      const settled = await writeSome(ports, userId, waiting.slice(0, plan.write), deadline, target, summary, failedIds);
      if (settled === 0) {
        summary.stopped = ports.now() >= deadline ? 'deadline' : 'no-progress';
        break;
      }
      continue;
    }

    if (summary.pickRounds >= MAX_PICK_ROUNDS) {
      summary.stopped = 'pick-rounds';
      break;
    }
    if (deadline - ports.now() < PICK_RESERVE_MS) {
      summary.stopped = 'deadline';
      break;
    }
    summary.pickRounds += 1;
    const picked = await ports.pick(userId, plan.draw, deadline - PICK_RESERVE_MS / 2);
    summary.picked += picked;
    if (picked === 0) {
      summary.stopped = 'nothing-to-pick';
      break;
    }
  }

  return summary;
}

/**
 * Write the given cards, `WRITE_CONCURRENCY` at a time, until they are done,
 * the target is reached, or the deadline passes. Returns how many were
 * settled, ready or dropped.
 *
 * The plan counts one card per picked row, but a section can make a card for
 * each of up to three ideas, so a batch can reach the target early; no batch
 * is started after it has.
 */
async function writeSome(
  ports: TopUpPorts,
  userId: string,
  cards: CardToWrite[],
  deadline: number,
  target: number,
  summary: TopUpSummary,
  failedIds: Set<string>,
): Promise<number> {
  let settled = 0;
  for (let start = 0; start < cards.length; start += WRITE_CONCURRENCY) {
    if (ports.now() >= deadline) break;
    if (summary.readyAfter >= target) break;
    const batch = cards.slice(start, start + WRITE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((card) =>
        ports.write(userId, card).catch(
          (error: unknown): WriteResult => ({
            outcome: 'failed',
            detail: error instanceof Error ? error.message : 'failed',
          }),
        ),
      ),
    );
    results.forEach((result, index) => {
      const card = batch[index];
      if (result.outcome === 'ready') {
        // One section can make a card for each of its ideas.
        summary.written += result.ideas.length;
        summary.readyAfter += result.ideas.length;
        settled += 1;
      } else if (result.outcome === 'dropped') {
        summary.dropped.push({ article: card.article, section: card.section, reason: result.reason });
        settled += 1;
      } else {
        failedIds.add(card.id);
        summary.failed.push(`${card.article}: ${result.detail}`);
      }
    });
  }
  return settled;
}
