import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Whether the browser runner is up on the person's PC and Mac (plan #3075),
 * read from core.browser_runners (migration 0312): one row per computer,
 * with when its runner last sent a heartbeat.
 *
 * The runner (scripts/browser-runner.ts) sends one every 30 seconds, so a
 * computer is up while its last one is under RUNNER_UP_MS old. The claim
 * function treats the PC as gone after the same 2 minutes. A runner whose
 * Claude in Chrome did not answer stops sending them for 5 minutes, so a
 * computer seen a few minutes ago is most often that.
 *
 * Every browser hand-off up to 8 November 2026 fell back to the cloud with
 * only "couldn't reach your Chrome", while the table had no row at all: the
 * runner had never run. These words are what Home and the thread say now.
 */

export type RunnerMachine = 'pc' | 'mac';

const MACHINES: readonly RunnerMachine[] = ['pc', 'mac'];

/** Under this since its last heartbeat, a computer's runner is up. */
export const RUNNER_UP_MS = 2 * 60_000;

/** Seen this recently but not up: most likely standing down after Chrome did not answer. */
const STOOD_DOWN_MS = 10 * 60_000;

export type RunnerStatus = {
  machine: RunnerMachine;
  /** When its runner last sent a heartbeat; null when it never has. */
  lastSeenAt: string | null;
  up: boolean;
};

/** Each computer's status, the PC first, from the table's rows. */
export function runnerStatuses(
  rows: readonly { machine: string; last_seen_at: string | null }[],
  now: number,
): RunnerStatus[] {
  return MACHINES.map((machine) => {
    const row = rows.find((each) => each.machine === machine);
    const lastSeenAt = row?.last_seen_at ?? null;
    const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    return { machine, lastSeenAt, up: Number.isFinite(seen) && now - seen < RUNNER_UP_MS };
  });
}

function machineWord(machine: RunnerMachine): string {
  return machine === 'pc' ? 'PC' : 'Mac';
}

/** "4 minutes", "3 hours", "2 days": how long ago, in the largest whole unit. */
export function agoWords(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return unit(hours, 'hour');
  return unit(Math.floor(hours / 24), 'day');
}

function sinceSeen(status: RunnerStatus, now: number): number | null {
  const seen = status.lastSeenAt ? Date.parse(status.lastSeenAt) : NaN;
  return Number.isFinite(seen) ? Math.max(0, now - seen) : null;
}

/**
 * One sentence for the thread on why no computer took a browser task: which
 * runner is up, when each was last seen, or that neither has ever run.
 */
export function runnerStatusSentence(statuses: readonly RunnerStatus[], now: number): string {
  const pc = statuses.find((each) => each.machine === 'pc');
  const mac = statuses.find((each) => each.machine === 'mac');
  const ever = statuses.filter((each) => each.lastSeenAt);
  if (ever.length === 0) {
    return "The browser runner has never run on your PC or your Mac, so nothing there can pick up a browser task (npm run browser-runner -- pc starts it).";
  }
  const up = statuses.filter((each) => each.up);
  if (up.length > 0) {
    const names = up.map((each) => `your ${machineWord(each.machine)}`).join(' and ');
    return `The browser runner is up on ${names} but did not take this, so Claude in Chrome most likely isn't connected there.`;
  }
  const parts = [pc, mac]
    .filter((each): each is RunnerStatus => Boolean(each))
    .map((each) => {
      const since = sinceSeen(each, now);
      const where = `your ${machineWord(each.machine)}`;
      if (since === null) return `it has never run on ${where}`;
      if (since < STOOD_DOWN_MS) {
        return `it was last seen on ${where} ${agoWords(since)} ago, which usually means Claude in Chrome didn't answer there and it stood down`;
      }
      return `it was last seen on ${where} ${agoWords(since)} ago`;
    });
  return `The browser runner isn't running: ${parts.join(', and ')}.`;
}

/** The chip on Home: a few words, and whether that is fine. */
export function runnerChipValue(statuses: readonly RunnerStatus[], now: number): { value: string; up: boolean } {
  const up = statuses.filter((each) => each.up);
  if (up.length > 0) return { value: `${up.map((each) => machineWord(each.machine)).join(' and ')} up`, up: true };
  const seen = statuses
    .map((each) => ({ each, since: sinceSeen(each, now) }))
    .filter((entry): entry is { each: RunnerStatus; since: number } => entry.since !== null)
    .sort((a, b) => a.since - b.since);
  if (seen.length === 0) return { value: 'Never run', up: false };
  return { value: `${machineWord(seen[0].each.machine)} seen ${agoWords(seen[0].since)} ago`, up: false };
}

/** The owner's runners, or null when they could not be read. */
export async function loadRunnerStatuses(
  core: CoreSupabaseClient,
  userId: string,
  now: number,
): Promise<RunnerStatus[] | null> {
  try {
    const { data, error } = await core
      .from('browser_runners')
      .select('machine, last_seen_at')
      .eq('user_id', userId);
    if (error) {
      console.error('the browser runners were not read', error.message);
      return null;
    }
    return runnerStatuses((data ?? []) as { machine: string; last_seen_at: string | null }[], now);
  } catch (error) {
    console.error('the browser runners were not read', error);
    return null;
  }
}
