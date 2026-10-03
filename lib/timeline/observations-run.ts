import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  checkObservations,
  NOT_USEFUL_DAYS,
  observationWeek,
  RECENT_WEEKS,
  summariseTimeline,
  type DropReason,
  type RawObservation,
} from './observations';
import type { TimelineEvent, TimelineModule } from './timeline';

/**
 * One person's weekly observations (plan #1119): read twelve weeks of their
 * timeline, have the model say what it noticed, keep what passes the checks,
 * store it under the week.
 *
 * A week is keyed by its Monday. A second run in the same week finds that
 * week's rows and does nothing, so a retried cron call does not pay twice
 * for a week that had something to say. A week with nothing worth saying
 * stores nothing.
 */

export type ObservationRow = {
  user_id: string;
  week: string;
  position: number;
  sentence: string;
  evidence: string[];
  modules: TimelineModule[];
  model: string | null;
};

export type ObservationRunPorts = {
  /** Whether rows already exist for this person and week. */
  hasWeek(userId: string, week: string): Promise<boolean>;
  /** This person's timeline events in [from, to). */
  timeline(userId: string, from: string, to: string): Promise<TimelineEvent[]>;
  /** Sentences marked not useful since `since`. */
  notUseful(userId: string, since: string): Promise<string[]>;
  /** Sentences stored for weeks on or after `sinceWeek` and before `week`. */
  recent(userId: string, sinceWeek: string, week: string): Promise<string[]>;
  /** The model's observations, unchecked. */
  observe(
    input: { summary: string; notUseful: string[]; recent: string[] },
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; observations: RawObservation[] } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  write(rows: ObservationRow[]): Promise<void>;
  /**
   * Whether the model was paid to write this person's observations between
   * two instants. What tells a week that had nothing to say, which stores no
   * rows, from one whose run failed before the model answered.
   */
  asked?(userId: string, from: string, to: string): Promise<boolean>;
};

export type ObservationRunResult =
  | { status: 'already-run' }
  | { status: 'no-events' }
  | { status: 'no-model' }
  | { status: 'written'; events: number; observations: number; dropped: DropReason[] };

const DAY_MS = 86_400_000;

export async function runObservationsFor(
  ports: ObservationRunPorts,
  userId: string,
  now: Date,
): Promise<ObservationRunResult> {
  const window = observationWeek(now);
  if (await ports.hasWeek(userId, window.week)) return { status: 'already-run' };

  const events = await ports.timeline(userId, window.from, window.to);
  if (events.length === 0) return { status: 'no-events' };

  const since = new Date(now.getTime() - NOT_USEFUL_DAYS * DAY_MS).toISOString();
  const sinceWeek = new Date(Date.parse(window.to) - RECENT_WEEKS * 7 * DAY_MS).toISOString().slice(0, 10);
  const [notUseful, recent] = await Promise.all([
    ports.notUseful(userId, since),
    ports.recent(userId, sinceWeek, window.week),
  ]);

  const input = summariseTimeline(events, window);
  const reports: SpendReport[] = [];
  let reply;
  try {
    reply = await ports.observe({ summary: input.summary, notUseful, recent }, (report) => reports.push(report));
  } finally {
    for (const report of reports) await ports.ledger(userId, report);
  }
  if (!reply) return { status: 'no-model' };

  const { kept, dropped } = checkObservations(reply.observations, input.events, notUseful);
  const rows: ObservationRow[] = kept.map((observation, index) => ({
    user_id: userId,
    week: window.week,
    position: index + 1,
    sentence: observation.sentence,
    evidence: observation.evidence,
    modules: observation.modules,
    model: reply.model,
  }));
  if (rows.length > 0) await ports.write(rows);
  return { status: 'written', events: events.length, observations: rows.length, dropped };
}

/**
 * The week before `now`'s, written now if the run that should have written it
 * failed.
 *
 * Nothing retries a weekly run: on 28 September the model credit ran out, the
 * route answered 200 with the failure inside, and the week was lost. So each
 * run first looks at the week before. A week with rows is done. A week with
 * none whose run still paid for a model call had nothing worth saying, and is
 * left alone too, so a quiet week is not paid for twice. Anything else is run
 * now, as of a week ago, which reads the same twelve weeks that run would have.
 */
export async function catchUpObservations(
  ports: ObservationRunPorts,
  userId: string,
  now: Date,
): Promise<ObservationRunResult> {
  const then = new Date(now.getTime() - 7 * DAY_MS);
  const missed = observationWeek(then);
  if (await ports.hasWeek(userId, missed.week)) return { status: 'already-run' };
  if (ports.asked && (await ports.asked(userId, missed.to, observationWeek(now).to))) {
    return { status: 'already-run' };
  }
  return runObservationsFor(ports, userId, then);
}
