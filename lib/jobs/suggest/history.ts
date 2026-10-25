import type { Seniority } from './scores';

/**
 * How past applications to similar roles went (plan #1202).
 *
 * Jev's chance score reads this beside the opening's text, so the estimate of
 * reaching an interview rests on what happened to applications like it and
 * not on the wording alone. "Chance" means the chance of an interview (#1201).
 *
 * Pure, so the summary can be tested and reused: #1203 scores open
 * applications the same way and passes the application's own id as
 * `excludeId`, so it is not counted as history for itself.
 */

/** One application on file, as the history reads it. */
export type PastApplication = {
  id: string;
  title: string;
  company: string | null;
  status: string;
  /** The override when set, else the stage the pipeline worked out. */
  rejectionStage: string | null;
  /** Whether any interview row is on file for it. */
  hasInterview: boolean;
  /** applications.source: `linkedin` on a sent application is Easy Apply. Absent reads as direct. */
  source?: string | null;
  /** When it went in: submitted_at, else created_at. Absent leaves it out of the months. */
  sentAt?: string | null;
};

/**
 * How an application went in. Easy Apply and a direct application are
 * different bets: on 24 October 2026 the 460 Easy Apply ones LinkedIn's
 * export brought in had no interviews, against 34 of 394 sent directly, so
 * the chance of one is read against the others sent the same way.
 */
export type Channel = 'direct' | 'easy_apply';

export const CHANNEL_LABELS: Record<Channel, string> = {
  direct: 'sent directly, on the company\'s site or through a person',
  easy_apply: 'LinkedIn Easy Apply',
};

/**
 * The channel of a sent application. One not sent yet is taken as direct:
 * LinkedIn on a lead says where it was found, not how it will go in.
 */
export function channelOf(app: Pick<PastApplication, 'status' | 'source'>): Channel {
  return app.source === 'linkedin' && wasSent(app) ? 'easy_apply' : 'direct';
}

/** Statuses that mean nothing was sent, so they are not history. */
const NOT_SENT = new Set(['lead', 'drafting']);

/** Whether the application was sent, so it counts as history. */
export function wasSent(app: Pick<PastApplication, 'status'>): boolean {
  return !NOT_SENT.has(app.status);
}

/** Statuses that mean the application got past the screen. */
const INTERVIEW_STATUSES = new Set(['in_process', 'final_round', 'offer']);

/** Rejection stages that come after a first conversation with someone. */
const INTERVIEW_STAGES = new Set(['recruiter_screen', 'hiring_manager', 'technical', 'onsite', 'final', 'offer_stage']);

/** Statuses still waiting on a reply, neither an interview nor a no. */
const WAITING = new Set(['submitted', 'acknowledged']);

/** Whether an application reached an interview: an interview on file, a later status, or a rejection after a screen. */
export function reachedInterview(app: PastApplication): boolean {
  if (app.hasInterview) return true;
  if (INTERVIEW_STATUSES.has(app.status)) return true;
  return app.rejectionStage !== null && INTERVIEW_STAGES.has(app.rejectionStage);
}

const LEVEL_RANK: Record<Seniority, number> = { entry: 0, mid: 1, senior: 2, executive: 3 };

/**
 * The level a title reads as, on the same four steps as the seniority
 * question. A title with no level word is taken as mid level.
 */
export function titleLevel(title: string): Seniority {
  const t = ` ${title.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  if (/ (director|vp|vice president|chief|cfo|coo|ceo|controller|head of finance) /.test(t)) return 'executive';
  if (/ (head|lead|principal|staff) /.test(t) || / senior manager /.test(t)) return 'senior';
  if (/ (senior|sr) /.test(t) && / (associate|analyst|specialist|accountant) /.test(t)) return 'mid';
  if (/ (manager|consultant) /.test(t)) return 'mid';
  if (/ (senior|sr) /.test(t)) return 'senior';
  if (/ (analyst|associate|specialist|coordinator|junior|jr|intern|assistant|accountant) /.test(t)) return 'entry';
  return 'mid';
}

/** Words that say the level, the employment terms or nothing, and so say nothing about the kind of work. */
const NOT_THE_WORK = new Set([
  'a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'with', 'i', 'ii', 'iii', 'iv',
  'senior', 'sr', 'junior', 'jr', 'associate', 'analyst', 'specialist', 'coordinator', 'intern',
  'assistant', 'manager', 'director', 'vp', 'vice', 'president', 'head', 'lead', 'principal', 'staff',
  'chief', 'officer', 'consultant', 'remote', 'hybrid', 'contract', 'temporary', 'full', 'part', 'time',
]);

/**
 * The stems naming the kind of work in a title: level words dropped, each
 * word cut to its first six letters so "finance" and "financial", or
 * "strategy" and "strategic", meet.
 */
export function workStems(title: string): Set<string> {
  const stems = new Set<string>();
  for (const word of title.toLowerCase().split(/[^a-z]+/)) {
    if (word.length < 2 || NOT_THE_WORK.has(word)) continue;
    stems.add(word.slice(0, 6));
  }
  return stems;
}

/** Similar: at least one stem of the work in common, and a level no more than one step apart. */
export function isSimilarTitle(a: string, b: string): boolean {
  if (Math.abs(LEVEL_RANK[titleLevel(a)] - LEVEL_RANK[titleLevel(b)]) > 1) return false;
  const stems = workStems(b);
  for (const stem of workStems(a)) if (stems.has(stem)) return true;
  return false;
}

/** How a set of applications went. */
export type HistoryCounts = {
  applied: number;
  reached_an_interview: number;
  /** Sent and not yet answered either way. */
  still_waiting: number;
};

/** One calendar month of applications sent the same way, by when they went in. */
export type MonthCounts = HistoryCounts & { month: string };

/**
 * What Jev is told. `similar` and `all_applications` count only the
 * applications sent the same way as the one being scored, so a run of Easy
 * Apply does not set the rate for a direct application. `by_month` shows
 * whether that rate is moving, and `other_channel` how the rest went.
 */
export type HistorySummary = {
  channel: Channel;
  similar: HistoryCounts & { examples: string[] };
  all_applications: HistoryCounts;
  by_month: MonthCounts[];
  other_channel: HistoryCounts & { channel: Channel };
};

/** How many recent months the trend covers, this one included. */
export const HISTORY_MONTHS = 4;

/** How many similar applications Jev reads by name. */
export const HISTORY_EXAMPLES = 12;

function counts(apps: PastApplication[]): HistoryCounts {
  return {
    applied: apps.length,
    reached_an_interview: apps.filter(reachedInterview).length,
    still_waiting: apps.filter((app) => !reachedInterview(app) && WAITING.has(app.status)).length,
  };
}

function outcome(app: PastApplication): string {
  if (reachedInterview(app)) return 'reached an interview';
  if (WAITING.has(app.status)) return 'no reply yet';
  if (app.status === 'rejected' && app.rejectionStage && app.rejectionStage !== 'unknown') {
    return `rejected at ${app.rejectionStage.replace(/_/g, ' ')}`;
  }
  return app.status.replace(/_/g, ' ');
}

/** The last `HISTORY_MONTHS` calendar months as YYYY-MM, oldest first. */
export function recentMonths(now: Date): string[] {
  const months: string[] = [];
  for (let back = HISTORY_MONTHS - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(at.toISOString().slice(0, 7));
  }
  return months;
}

/**
 * The history for one title, against the applications sent through
 * `options.channel` (direct when absent). `history` is newest first; the
 * examples keep that order and put the ones that reached an interview first,
 * since those are the few that say what worked.
 */
export function summariseHistory(
  title: string,
  history: readonly PastApplication[],
  options: { excludeId?: string; channel?: Channel; now?: Date } = {},
): HistorySummary {
  const channel = options.channel ?? 'direct';
  const sent = history.filter((app) => wasSent(app) && app.id !== options.excludeId);
  const same = sent.filter((app) => channelOf(app) === channel);
  const other = sent.filter((app) => channelOf(app) !== channel);
  const similar = same.filter((app) => isSimilarTitle(title, app.title));
  const ordered = [...similar.filter(reachedInterview), ...similar.filter((app) => !reachedInterview(app))];
  return {
    channel,
    similar: {
      ...counts(similar),
      examples: ordered
        .slice(0, HISTORY_EXAMPLES)
        .map((app) => `${app.title} at ${app.company ?? 'an unnamed company'}: ${outcome(app)}`),
    },
    all_applications: counts(same),
    by_month: recentMonths(options.now ?? new Date()).map((month) => ({
      month,
      ...counts(same.filter((app) => app.sentAt?.slice(0, 7) === month)),
    })),
    other_channel: { channel: channel === 'direct' ? 'easy_apply' : 'direct', ...counts(other) },
  };
}
