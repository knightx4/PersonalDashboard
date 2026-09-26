/**
 * Check-backs: work a session means to come back to after some time
 * (supabase/migrations/0103_check_backs.sql).
 *
 * The rules every caller shares, with no database and no clock of their own:
 * how "--after 2h" is read, which due check-backs the tick may wake a session
 * for, and what that session is told. The CLI (scripts/plan.ts), the tick
 * (inngest/dev/check-backs.ts) and the Dash tab all read them from here.
 */

export type CheckBackStatus = 'waiting' | 'done' | 'dropped';

export type CheckBack = {
  id: string;
  userId: string;
  title: string;
  detail: string | null;
  dueAt: string;
  planItemId: string | null;
  source: string | null;
  wake: boolean;
  status: CheckBackStatus;
  outcome: string | null;
  closedAt: string | null;
  wokeAt: string | null;
  createdAt: string;
};

export const CHECK_BACK_COLUMNS =
  'id, user_id, title, detail, due_at, plan_item_id, source, wake, status, outcome, closed_at, woke_at, created_at';

export function checkBackFrom(row: Record<string, unknown>): CheckBack {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    detail: (row.detail as string | null) ?? null,
    dueAt: String(row.due_at),
    planItemId: (row.plan_item_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    wake: Boolean(row.wake),
    status: row.status as CheckBackStatus,
    outcome: (row.outcome as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    wokeAt: (row.woke_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/**
 * How long a check-back may sit due before the tick wakes a session for it.
 * Long enough that a Dash session running anyway usually gets there first,
 * which costs nothing extra.
 */
export const WAKE_GRACE_MS = 60 * 60 * 1000;

/** Sessions the tick may start for check-backs in one UTC day, per account. */
export const WAKES_PER_DAY = 3;

/** The furthest ahead a check-back may be set. */
export const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * "90m", "2h", "1d", "1h30m" as milliseconds, or null for anything else.
 * At least a minute and at most `MAX_DELAY_MS`.
 */
export function parseDelay(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (!/^(\d+[mhd])+$/.test(trimmed)) return null;
  let total = 0;
  for (const [, amount, unit] of trimmed.matchAll(/(\d+)([mhd])/g)) {
    total += Number(amount) * UNIT_MS[unit!]!;
  }
  return total >= UNIT_MS.m! && total <= MAX_DELAY_MS ? total : null;
}

export function isDue(checkBack: Pick<CheckBack, 'status' | 'dueAt'>, now: number): boolean {
  return checkBack.status === 'waiting' && new Date(checkBack.dueAt).getTime() <= now;
}

/** Midnight UTC of the day `now` falls in: where the daily wake count starts. */
export function wakeDayStart(now: number): number {
  const day = new Date(now);
  return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
}

/**
 * The check-backs one account's tick should wake a session for, oldest first.
 *
 * All of them go to one session: a session handed three things to look at
 * costs one start rather than three. None when the account has used its
 * wakes for the day, and none that a session was already woken for.
 */
export function chooseWake(
  waiting: readonly CheckBack[],
  wokenToday: number,
  now: number,
): CheckBack[] {
  if (wokenToday >= WAKES_PER_DAY) return [];
  return waiting
    .filter(
      (row) =>
        row.status === 'waiting' &&
        row.wake &&
        row.wokeAt === null &&
        new Date(row.dueAt).getTime() + WAKE_GRACE_MS <= now,
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** "in 2h 5m", "5m ago", "now": how the CLI and the Dash tab say a due time. */
export function dueWords(dueAt: string, now: number): string {
  const diff = new Date(dueAt).getTime() - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes === 0) return 'now';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const span = [days ? `${days}d` : '', hours ? `${hours}h` : '', rest && !days ? `${rest}m` : '']
    .filter(Boolean)
    .join(' ');
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

/**
 * The brief a woken session starts with: each check-back in full, and how to
 * close it. The session is the plan routine, so it has the repository, the
 * plan CLI and the database.
 */
export function wakeTurn(rows: readonly CheckBack[]): string {
  const items = rows
    .map((row) =>
      [
        `### ${row.title}`,
        `id: ${row.id} · due ${row.dueAt}${row.source ? ` · from ${row.source}` : ''}`,
        row.detail ? `\n${row.detail}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
  return (
    `A session asked to come back to ${rows.length === 1 ? 'this' : 'these'} after some time, ` +
    'and no session has picked it up since it fell due. Do each check now: look at what it names, ' +
    'act on what you find the way the check says to, and commit and push anything you change.\n\n' +
    `${items}\n\n` +
    '## Closing each one\n\n' +
    'npx tsx scripts/plan.ts checked <id> --note "what you found and what you did"\n\n' +
    'Use `--drop` in place of a finding when it no longer matters. If it needs another look later, ' +
    'close this one and add the next with `plan.ts check-back "…" --after <time>`. If what you ' +
    'found needs the person, raise it with `plan.ts raise` rather than leaving it in the note.'
  );
}
