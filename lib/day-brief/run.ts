import type { SpendReport } from '@/lib/core/spend/pricing';
import { briefDay, checkBrief, isQuiet, plainBrief, QUIET_LINE, type BriefFact } from './facts';

/**
 * One person's morning brief (plan #1123): in their morning window, gather
 * the day's facts, have the model write them up, store the brief under the
 * day, and hand the stored row to `written`.
 *
 * A day is written once. The hourly tick finds the row on its next call and
 * does nothing, so a retried call does not pay twice. A quiet day is the one
 * line QUIET_LINE, with no model call. Without a key, or when the call fails
 * or returns something unusable, the plain brief is stored instead, so the
 * home page still opens on the day.
 */

export type DayBriefRow = {
  user_id: string;
  day: string;
  body: string;
  facts: BriefFact[];
  model: string | null;
};

export type DayBriefPorts = {
  /** Whether this person's brief for this day is already stored. */
  hasBrief(userId: string, day: string): Promise<boolean>;
  /** The day's facts for this person (lib/day-brief/facts.ts). */
  facts(userId: string, day: string): Promise<BriefFact[]>;
  /** The model's brief, unchecked; null when there is no model to ask. */
  write(
    day: string,
    facts: BriefFact[],
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; text: string | null } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Stores the row; false when a brief for the day was already there. */
  save(row: DayBriefRow): Promise<boolean>;
  /**
   * Called once the row is stored, and only then. The phone notification
   * (plan #1124) is sent from here.
   */
  written?(row: DayBriefRow): Promise<void>;
};

export type DayBriefResult =
  | { status: 'not-morning' }
  | { status: 'already-written'; day: string }
  | { status: 'written'; day: string; quiet: boolean; model: string | null; facts: number };

export async function runDayBriefFor(
  ports: DayBriefPorts,
  person: { userId: string; timezone: string },
  now: Date,
): Promise<DayBriefResult> {
  const day = briefDay(person.timezone, now);
  if (!day) return { status: 'not-morning' };
  if (await ports.hasBrief(person.userId, day)) return { status: 'already-written', day };

  const facts = await ports.facts(person.userId, day);
  const quiet = isQuiet(facts);

  let body = quiet ? QUIET_LINE : null;
  let model: string | null = null;
  if (!quiet) {
    const reports: SpendReport[] = [];
    try {
      const reply = await ports.write(day, facts, (report) => reports.push(report));
      const checked = reply?.text ? checkBrief(reply.text) : null;
      if (reply && checked) {
        body = checked;
        model = reply.model;
      }
    } catch {
      // The plain brief below stands in; the failure costs the prose, not the day.
    } finally {
      for (const report of reports) await ports.ledger(person.userId, report);
    }
  }
  body ??= checkBrief(plainBrief(facts)) ?? plainBrief(facts).slice(0, 900);

  const row: DayBriefRow = { user_id: person.userId, day, body, facts, model };
  if (!(await ports.save(row))) return { status: 'already-written', day };
  await ports.written?.(row);
  return { status: 'written', day, quiet, model, facts: facts.length };
}
