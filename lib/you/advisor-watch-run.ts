import type { AskContext, AskRow } from '@/lib/ask/db';
import { runWatchQuery, type WatchMode, type WatchQuery } from '@/lib/you/advisor-watch';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { CANDIDATES_PER_WATCH, DUE_SLACK_MS, type CandidateRow, type DuePerson, type DueWatch } from '@/lib/you/reach-out-due';

/**
 * The daily round's run of the watches Dash wrote itself (plan #3030.1.3,
 * under #3030.1; the watches are you.advisor_watches, you 0050).
 *
 * Each active watch whose cadence has passed since its last run is run once
 * through query_rows for the owner (runWatchQuery). Its rows are compared
 * with what the last run saw (`seen`, each row's ref to a fingerprint of its
 * title and the columns query_rows read), and the rows that are new or
 * changed become the watch's candidates in the round brief, beside the fixed
 * watches of reach-out rules. A run with nothing new lists nothing, so its
 * mentor sends nothing.
 *
 *   - The first run of a watch (never run, nothing seen) takes what matches
 *     as already known and lists nothing: the person saw how many rows
 *     matched when they approved it, and asked to hear about what comes next.
 *   - What a run saw is kept only once it can no longer be lost: at once when
 *     it found nothing new, otherwise when the round has been fired with its
 *     rows in the brief. A watch whose mentor has an unread text, or a round
 *     that did not start, keeps its old `seen`, so the same rows are listed
 *     at the next round. Rows beyond the brief's six per watch keep their old
 *     fingerprint and come up next time.
 *   - A run that fails counts against the watch at once, with its error and
 *     the time, so a failing watch is tried once per cadence and not on every
 *     tick. Three failures in a row pause it, and its mentor says so in their
 *     thread.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Failed runs in a row that pause a watch. */
export const WATCH_FAILURES_TO_PAUSE = 3;
/** The most characters of an error a watch keeps (advisor_watches_last_error_ck). */
export const WATCH_ERROR_CHARS = 600;
/** advisor_messages.text_rule for the message that says a watch was paused. */
export const WATCH_PAUSED_RULE = 'watch_paused';

/** An active watch as the round reads it. */
export type ActiveWatch = {
  id: string;
  advisorId: string;
  key: string;
  about: string;
  query: WatchQuery;
  everyDays: number;
  mode: WatchMode;
  failures: number;
  lastRunAt: string | null;
  seen: Record<string, string>;
};

/** What to write back to a watch once its run is settled. */
export type WatchCommit = {
  id: string;
  advisorId: string;
  /** The new `seen`; absent when the run failed. */
  seen?: Record<string, string>;
  failures: number;
  lastError: string | null;
  lastRunAt: string;
  /** Three failures in a row: pause it and tell the person. */
  pause?: boolean;
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A row of you.advisor_watches as an ActiveWatch, or null when it is not one the round can run. */
export function activeWatchOf(row: Record<string, unknown>): ActiveWatch | null {
  const query = isObject(row.query) ? (row.query as unknown as WatchQuery) : null;
  const id = str(row.id);
  const advisorId = str(row.advisor_id);
  const key = str(row.key);
  const everyDays = typeof row.every_days === 'number' ? row.every_days : NaN;
  if (!id || !advisorId || !key || !query || !str(query.table) || !Number.isFinite(everyDays) || everyDays < 1) return null;
  const seen: Record<string, string> = {};
  if (isObject(row.seen)) for (const [ref, fp] of Object.entries(row.seen)) if (typeof fp === 'string') seen[ref] = fp;
  return {
    id,
    advisorId,
    key,
    about: str(row.about),
    query,
    everyDays,
    mode: row.mode === 'roundup' ? 'roundup' : 'each',
    failures: typeof row.failures === 'number' ? row.failures : 0,
    lastRunAt: str(row.last_run_at) || null,
    seen,
  };
}

/** Whether the watch's cadence has passed since its last run, with the round's slack. */
export function watchRunDue(watch: Pick<ActiveWatch, 'everyDays' | 'lastRunAt'>, now: number): boolean {
  const last = watch.lastRunAt ? Date.parse(watch.lastRunAt) : NaN;
  return !Number.isFinite(last) || now - last >= watch.everyDays * DAY_MS - DUE_SLACK_MS;
}

/** A short, stable fingerprint of what a row says: its title and the columns read with it. */
export function rowFingerprint(row: Pick<AskRow, 'title' | 'detail'>): string {
  const detail = row.detail ?? {};
  const text = JSON.stringify([row.title, Object.keys(detail).sort().map((k) => [k, detail[k] ?? null])]);
  // cyrb53: 53 bits is plenty to tell one version of a row from the next.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The rows new or changed since the last run, at most CANDIDATES_PER_WATCH,
 * and the `seen` to keep once they have been handed to the round. A row past
 * the cap keeps its old fingerprint (or none), so it is listed next time. The
 * first run lists nothing and keeps everything.
 */
export function diffWatchRows(
  watch: Pick<ActiveWatch, 'query' | 'lastRunAt' | 'seen'>,
  rows: readonly Pick<AskRow, 'ref' | 'title' | 'detail'>[],
): { candidates: CandidateRow[]; seen: Record<string, string> } {
  const first = watch.lastRunAt === null && Object.keys(watch.seen).length === 0;
  const seen: Record<string, string> = {};
  const candidates: CandidateRow[] = [];
  for (const row of rows) {
    if (!row.ref || row.ref in seen) continue;
    const fp = rowFingerprint(row);
    const before = watch.seen[row.ref];
    if (first || before === fp) {
      seen[row.ref] = fp;
      continue;
    }
    if (candidates.length >= CANDIDATES_PER_WATCH) {
      if (before !== undefined) seen[row.ref] = before;
      continue;
    }
    seen[row.ref] = fp;
    candidates.push({ table: watch.query.table, ref: row.ref, title: row.title, at: null, ...(before !== undefined ? { changed: true } : {}) });
  }
  return { candidates, seen };
}

/** What the mentor says in their thread when their watch is paused. */
export function pausedMessage(about: string, error: string | null): string {
  const what = about.replace(/\.$/, '') || 'what you asked me to watch';
  const why = error ? ` The last try said: ${error.replace(/\s+/g, ' ').slice(0, 200).replace(/\.$/, '')}.` : '';
  return `I've stopped checking for this: ${what}. It failed ${WATCH_FAILURES_TO_PAUSE} times in a row.${why} Ask me again in other words and I'll write a new one.`;
}

/** Add the custom watches' due people to the rule's, one block per person. */
export function mergeDue(a: readonly DuePerson[], b: readonly DuePerson[]): DuePerson[] {
  const out = a.map((p) => ({ ...p, watches: [...p.watches] }));
  for (const person of b) {
    const found = out.find((p) => p.advisorId === person.advisorId);
    if (found) found.watches.push(...person.watches);
    else out.push({ ...person, watches: [...person.watches] });
  }
  return out;
}

/**
 * Run every due active watch for the owner. Returns the people due by one
 * (mentors with an unread text left out, as the cap would refuse them), the
 * commits to keep once the round has started (`pending`), and the number
 * held back. Failed runs and runs with nothing new are kept here at once.
 */
export async function runDueWatches(input: {
  you: YouSupabaseClient;
  ask: AskContext;
  userId: string;
  unreadBy: ReadonlySet<string>;
  now: number;
  /** Runs one query; runWatchQuery when absent, a fake in tests. */
  run?: (ask: AskContext, query: WatchQuery) => Promise<{ rows: AskRow[] }>;
}): Promise<{ due: DuePerson[]; pending: WatchCommit[]; heldBack: number; paused: number }> {
  const { you, userId, now } = input;
  const run = input.run ?? runWatchQuery;
  const { data, error } = await you
    .from('advisor_watches')
    .select('id, advisor_id, key, about, query, every_days, mode, failures, last_run_at, seen')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (error) throw new Error(`Reading the watches failed: ${error.message}`);
  const watches = ((data ?? []) as Record<string, unknown>[])
    .map(activeWatchOf)
    .filter((w): w is ActiveWatch => w !== null && watchRunDue(w, now));
  if (watches.length === 0) return { due: [], pending: [], heldBack: 0, paused: 0 };

  const advisors = await you
    .from('board_advisors')
    .select('id, key, name')
    .eq('user_id', userId)
    .eq('active', true)
    .in('id', [...new Set(watches.map((w) => w.advisorId))]);
  if (advisors.error) throw new Error(`Reading who holds the watches failed: ${advisors.error.message}`);
  const byId = new Map(((advisors.data ?? []) as Record<string, unknown>[]).map((a) => [str(a.id), { key: str(a.key), name: str(a.name) }]));

  const at = new Date(now).toISOString();
  const immediate: WatchCommit[] = [];
  const pending: WatchCommit[] = [];
  const people = new Map<string, DuePerson>();
  let heldBack = 0;
  for (const watch of watches) {
    const advisor = byId.get(watch.advisorId);
    if (!advisor) continue;
    let rows: AskRow[];
    try {
      rows = (await run(input.ask, watch.query)).rows;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, WATCH_ERROR_CHARS) || 'The query failed.';
      const failures = watch.failures + 1;
      immediate.push({ id: watch.id, advisorId: watch.advisorId, failures, lastError: message, lastRunAt: at, pause: failures >= WATCH_FAILURES_TO_PAUSE });
      continue;
    }
    const diff = diffWatchRows(watch, rows);
    const commit: WatchCommit = { id: watch.id, advisorId: watch.advisorId, seen: diff.seen, failures: 0, lastError: null, lastRunAt: at };
    if (diff.candidates.length === 0) {
      immediate.push(commit);
      continue;
    }
    if (input.unreadBy.has(watch.advisorId)) {
      // The cap holds this mentor back; the rows stay new for the next round.
      heldBack += 1;
      continue;
    }
    pending.push(commit);
    const person = people.get(watch.advisorId) ?? { advisorId: watch.advisorId, key: advisor.key, name: advisor.name, watches: [] };
    const due: DueWatch = {
      key: watch.key,
      about: watch.about,
      mode: watch.mode,
      form: null,
      everyDays: watch.everyDays,
      repeatAfterDays: null,
      candidates: diff.candidates,
      custom: true,
    };
    person.watches.push(due);
    people.set(watch.advisorId, person);
  }
  await commitWatchRuns(you, userId, immediate, byId);
  return { due: [...people.values()], pending, heldBack, paused: immediate.filter((c) => c.pause).length };
}

/**
 * Keep what the runs found. A paused watch's mentor says so in their thread
 * (text_rule watch_paused, which the Council's caps do not count); a failure
 * to post it leaves the watch paused all the same, and the mentor page shows
 * it paused.
 */
export async function commitWatchRuns(
  you: YouSupabaseClient,
  userId: string,
  commits: readonly WatchCommit[],
  names?: ReadonlyMap<string, { name: string }>,
): Promise<void> {
  for (const c of commits) {
    const patch: Record<string, unknown> = { failures: c.failures, last_error: c.lastError, last_run_at: c.lastRunAt };
    if (c.seen) patch.seen = c.seen;
    if (c.pause) patch.status = 'paused';
    let update = you.from('advisor_watches').update(patch).eq('user_id', userId).eq('id', c.id);
    // A watch the person stopped while it ran stays stopped.
    if (c.pause) update = update.eq('status', 'active');
    const { data, error } = await update.select('about');
    if (error) throw new Error(`Keeping the watch's run failed: ${error.message}`);
    const about = str(((data ?? []) as Record<string, unknown>[])[0]?.about);
    if (!c.pause || !about) continue;
    try {
      await postPausedMessage(you, userId, c.advisorId, names?.get(c.advisorId)?.name ?? '', pausedMessage(about, c.lastError), c.lastRunAt);
    } catch (err) {
      console.error('advisor watch: telling the person it paused failed', err instanceof Error ? err.message : err);
    }
  }
}

async function postPausedMessage(you: YouSupabaseClient, userId: string, advisorId: string, name: string, text: string, at: string): Promise<void> {
  const found = await you
    .from('advisor_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('advisor_id', advisorId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let chatId = str((found.data as { id?: unknown } | null)?.id);
  if (!chatId) {
    const made = await you
      .from('advisor_chats')
      .insert({ user_id: userId, advisor_id: advisorId, title: `Talking with ${name || 'them'}`.slice(0, 200) })
      .select('id')
      .single();
    if (made.error || !made.data) throw new Error(made.error?.message ?? 'no thread');
    chatId = str((made.data as { id?: unknown }).id);
  }
  const { error } = await you.from('advisor_messages').insert({
    user_id: userId,
    chat_id: chatId,
    role: 'advisor',
    kind: 'text_first',
    text_rule: WATCH_PAUSED_RULE,
    text,
    created_at: at,
  });
  if (error) throw new Error(error.message);
}
