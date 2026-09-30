import type { SpendReport } from '@/lib/core/spend/pricing';
import { briefDay, type BriefFact, type Candidate } from './facts';
import { checkNotification, NO_PICKS, plainNotification } from './notification';
import { fallbackPicks, picksFromKeys, shortlist, type DayBriefPick, type Shortlisted } from './picks';

/**
 * One person's morning brief (plan #1123): in their morning window, gather
 * the day's facts and candidates, choose the picks, have Dash write the
 * notification from them, store the brief under the day, and hand the stored
 * row to `written`.
 *
 * A day is written once. The hourly tick finds the row on its next call and
 * does nothing, so a retried call does not pay twice.
 *
 * The picks (plan #1239): the rules shortlist the day's candidates and Dash
 * picks one to three of them. Without a key, or when the choice fails or
 * names nothing on the shortlist, the shortlist's first three are stored.
 *
 * The notification (plan #1240) is written from the picks alone: a title
 * naming the first and a body with the rest, within what a lock screen shows
 * (notification.ts). Without a key, or when Dash's version fails its check,
 * the plain one built from the picks is stored instead. The facts are stored
 * with the row as a record of the day and are not written up.
 *
 * A day with no picks is stored with NO_PICKS, without asking Dash, and is
 * not handed to `written`: nothing is sent.
 */

export type DayBriefRow = {
  user_id: string;
  day: string;
  /** The notification's title, at most 50 characters (notification.ts). */
  title: string;
  /** The notification's body, at most 180 characters. */
  body: string;
  facts: BriefFact[];
  model: string | null;
  /**
   * What the brief names, at most three (lib/day-brief/picks.ts); empty on a
   * day where nothing qualified. In the table, null on rows written before #1239.
   */
  picks: DayBriefPick[];
};

export type DayBriefPorts = {
  /** Whether this person's brief for this day is already stored. */
  hasBrief(userId: string, day: string): Promise<boolean>;
  /** The day's facts for this person (lib/day-brief/facts.ts). */
  facts(userId: string, day: string): Promise<BriefFact[]>;
  /**
   * What could matter today, from every workspace (plan #1237;
   * lib/day-brief/facts.ts, Candidate). Shortlisted and picked from (#1239).
   */
  candidates?(userId: string, day: string, now: Date): Promise<Candidate[]>;
  /**
   * The keys Dash chose from the shortlist, unchecked; null when there is no
   * model to ask. Absent, the shortlist's first three are the picks.
   */
  choose?(
    day: string,
    list: Shortlisted[],
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; keys: string[] | null } | null>;
  /** Dash's notification from the picks, unchecked; null when there is no model to ask. */
  write(
    day: string,
    picks: DayBriefPick[],
    onSpend: (report: SpendReport) => void,
  ): Promise<{ model: string; reply: { title: string; body: string } | null } | null>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  /** Stores the row; false when a brief for the day was already there. */
  save(row: DayBriefRow): Promise<boolean>;
  /**
   * Called once the row is stored, and only then, and never for a day with
   * no picks. The phone notification (plan #1124) is sent from here.
   */
  written?(row: DayBriefRow): Promise<void>;
};

export type DayBriefResult =
  | { status: 'not-morning' }
  | { status: 'already-written'; day: string }
  | {
      status: 'written';
      day: string;
      /** Nothing qualified: no picks, and nothing sent. */
      quiet: boolean;
      model: string | null;
      facts: number;
      candidates: number;
      picks: number;
    };

export async function runDayBriefFor(
  ports: DayBriefPorts,
  person: { userId: string; timezone: string },
  now: Date,
): Promise<DayBriefResult> {
  const day = briefDay(person.timezone, now);
  if (!day) return { status: 'not-morning' };
  if (await ports.hasBrief(person.userId, day)) return { status: 'already-written', day };

  const facts = await ports.facts(person.userId, day);
  let candidates: Candidate[] = [];
  try {
    candidates = (await ports.candidates?.(person.userId, day, now)) ?? [];
  } catch {
    // The candidates are gathered part by part; a failure here costs them, not the brief.
  }

  const picks = await pickFor(ports, person, day, candidates);
  const quiet = picks.length === 0;

  let notification = quiet ? NO_PICKS : null;
  let model: string | null = null;
  if (!quiet) {
    const reports: SpendReport[] = [];
    try {
      const reply = await ports.write(day, picks, (report) => reports.push(report));
      const checked = reply?.reply ? checkNotification(reply.reply, picks) : null;
      if (reply && checked) {
        notification = checked;
        model = reply.model;
      }
    } catch {
      // The plain notification below stands in; the failure costs the wording, not the day.
    } finally {
      for (const report of reports) await ports.ledger(person.userId, report);
    }
  }
  notification ??= plainNotification(picks);

  const row: DayBriefRow = {
    user_id: person.userId,
    day,
    title: notification.title,
    body: notification.body,
    facts,
    model,
    picks,
  };
  if (!(await ports.save(row))) return { status: 'already-written', day };
  if (!quiet) await ports.written?.(row);
  return {
    status: 'written',
    day,
    quiet,
    model,
    facts: facts.length,
    candidates: candidates.length,
    picks: picks.length,
  };
}

/**
 * The day's picks: the shortlist's only entry when there is one, otherwise
 * Dash's choice from it, and the first three when that fails.
 */
async function pickFor(
  ports: DayBriefPorts,
  person: { userId: string; timezone: string },
  day: string,
  candidates: Candidate[],
): Promise<DayBriefPick[]> {
  const list = shortlist(candidates, person);
  if (list.length <= 1 || !ports.choose) return fallbackPicks(list);

  const reports: SpendReport[] = [];
  try {
    const reply = await ports.choose(day, list, (report) => reports.push(report));
    return (reply?.keys ? picksFromKeys(list, reply.keys) : null) ?? fallbackPicks(list);
  } catch {
    // The rules' order stands in; the failure costs Dash's judgement, not the picks.
    return fallbackPicks(list);
  } finally {
    for (const report of reports) await ports.ledger(person.userId, report);
  }
}
