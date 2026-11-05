import type { SupabaseClient } from '@supabase/supabase-js';
import { asText, listableSource, ownerColumn, viaTitle } from '@/lib/ask/list-rows';
import { readableName, type Source } from '@/lib/sources/types';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { parseReachOutRule, type ReachOutRule, type ReachOutWatch } from '@/lib/you/reach-out-rule';

/**
 * Who on People is due to text by their own rule (plan #2931.5).
 *
 * A person with a reach-out rule (you.board_advisors.reach_out_rule, you
 * 0044) speaks in the daily round only when one of their watches is due:
 *
 *   - Its cadence has passed. A watch's clock is the last row a text named
 *     under it (you.advisor_reach_outs), so a person a cap held back has
 *     written nothing and stays due for the next round. A watch that has
 *     never sent is due at once.
 *   - It has something to say. An `each` or `roundup` watch needs rows newer
 *     than its last text (on a first run, newer than its cadence); a `pick`
 *     watch may name any row.
 *   - Nothing repeats. A row this person already named inside the watch's
 *     no-repeat window (`repeat_after_days`, null for never) is not a
 *     candidate, whichever of their watches named it.
 *
 * This is worked out in code before the round is fired, so a round with
 * nobody due and nobody else free is never started, and the brief hands the
 * session each due person with the rows they may name. The session writes
 * one advisor_reach_outs row per row a text names, with the same ref_id form
 * this reads (the table's `ref` column from its reader below: a vault
 * note's path, otherwise its id).
 *
 * A person with no rule is not read here and keeps the round's own choice.
 * The global caps and quiet hours (you.advisor_texts_cap) still decide how
 * many texts go out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How early a watch counts as due. The round runs once a day, at least
 * twenty hours apart and at no fixed minute, so a weekly watch that sent at
 * 09:00 on Monday is due again at the next Monday's round even if it fires
 * at 08:05.
 */
export const DUE_SLACK_MS = 12 * 60 * 60 * 1000;
/** The most rows read from one table for one watch. */
export const ROWS_READ = 100;
/** The most candidate rows the brief lists for one watch. */
export const CANDIDATES_PER_WATCH = 6;
/** The most characters of a row's title the brief quotes. */
export const TITLE_CHARS = 90;
/** The most candidate lines in one brief, across everyone. */
export const BRIEF_CANDIDATES_MAX = 60;

/** A person on People with a rule, as the due check reads them. */
export type RulePerson = {
  advisorId: string;
  key: string;
  name: string;
  rule: ReachOutRule;
  /** They have a Council text the person has not read, so the cap lets them write nothing. */
  unread: boolean;
};

/** A row a text from this person named (you.advisor_reach_outs). */
export type SentRef = { watchKey: string; refTable: string; refId: string; sentAt: string };

/** A row a watch may name. */
export type CandidateRow = { table: string; ref: string; title: string; at: string | null };

export type DueWatch = {
  key: string;
  about: string;
  mode: ReachOutWatch['mode'];
  form: ReachOutWatch['form'] | null;
  everyDays: number;
  repeatAfterDays: number | null;
  candidates: CandidateRow[];
};

export type DuePerson = { advisorId: string; key: string; name: string; watches: DueWatch[] };

/** The newest time a row was named under this watch, or null when it never has. */
export function lastSentUnder(watchKey: string, sent: readonly SentRef[]): number | null {
  let last: number | null = null;
  for (const s of sent) {
    if (s.watchKey !== watchKey) continue;
    const at = Date.parse(s.sentAt);
    if (Number.isFinite(at) && (last === null || at > last)) last = at;
  }
  return last;
}

/**
 * Whether the watch's cadence has passed, and how far back its rows are new.
 * `since` is null for a `pick` watch, which may name any row it has not
 * named inside its window.
 */
export function watchClock(watch: ReachOutWatch, sent: readonly SentRef[], now: number): { due: boolean; since: string | null } {
  const last = lastSentUnder(watch.key, sent);
  const cadence = watch.every_days * DAY_MS;
  const due = last === null || now - last >= cadence - DUE_SLACK_MS;
  if (watch.mode === 'pick') return { due, since: null };
  return { due, since: new Date(last ?? now - cadence).toISOString() };
}

/** Whether this person named the row inside the watch's no-repeat window. */
export function namedLately(
  row: Pick<CandidateRow, 'table' | 'ref'>,
  watch: Pick<ReachOutWatch, 'repeat_after_days'>,
  sent: readonly SentRef[],
  now: number,
): boolean {
  const window = watch.repeat_after_days === null ? null : watch.repeat_after_days * DAY_MS;
  return sent.some((s) => {
    if (s.refTable !== row.table || s.refId !== row.ref) return false;
    if (window === null) return true;
    const at = Date.parse(s.sentAt);
    return Number.isFinite(at) && now - at < window;
  });
}

/**
 * The person's due watches, from the rows each watch's tables hold. Pure:
 * `rowsFor` gives the rows already read for a watch (newest first), so the
 * tests fix them and the clock.
 */
export function dueWatchesOf(input: {
  person: Pick<RulePerson, 'rule'>;
  sent: readonly SentRef[];
  rowsFor: (watch: ReachOutWatch, since: string | null) => readonly CandidateRow[];
  now: number;
}): DueWatch[] {
  const { sent, now } = input;
  const due: DueWatch[] = [];
  for (const watch of input.person.rule.watches) {
    const clock = watchClock(watch, sent, now);
    if (!clock.due) continue;
    const seen = new Set<string>();
    const candidates: CandidateRow[] = [];
    for (const row of input.rowsFor(watch, clock.since)) {
      const id = `${row.table}:${row.ref}`;
      if (seen.has(id) || namedLately(row, watch, sent, now)) continue;
      if (clock.since && row.at && Date.parse(row.at) <= Date.parse(clock.since)) continue;
      seen.add(id);
      candidates.push(row);
      if (candidates.length >= CANDIDATES_PER_WATCH) break;
    }
    if (candidates.length === 0) continue;
    due.push({
      key: watch.key,
      about: watch.about,
      mode: watch.mode,
      form: watch.form ?? null,
      everyDays: watch.every_days,
      repeatAfterDays: watch.repeat_after_days,
      candidates,
    });
  }
  return due;
}

/**
 * Who the round may hand a due rule to: due, and free to write. A person
 * with an unread text is held back by the cap; nothing is written for them,
 * so their watches are still due at the next round.
 */
export function dueSummary(people: readonly (RulePerson & { watches: DueWatch[] })[]): { due: DuePerson[]; heldBack: number } {
  const due = people
    .filter((p) => p.watches.length > 0 && !p.unread)
    .map((p) => ({ advisorId: p.advisorId, key: p.key, name: p.name, watches: p.watches }));
  const heldBack = people.filter((p) => p.watches.length > 0 && p.unread).length;
  return { due, heldBack };
}

/** The brief's list of due people, one block each; empty when nobody is due. */
export function dueBriefLines(due: readonly DuePerson[]): string[] {
  if (due.length === 0) return [];
  const lines = ['Due by their own rule (plan #2931.5); see A3:'];
  let listed = 0;
  for (const person of due) {
    lines.push(`- ${person.name} (${person.key}, advisor ${person.advisorId})`);
    for (const watch of person.watches) {
      const repeat = watch.repeatAfterDays === null ? 'never repeat' : `repeat after ${watch.repeatAfterDays} days`;
      const form = watch.form ? `, ${watch.form}` : '';
      lines.push(`  - watch ${watch.key} [${watch.mode}${form}, every ${watch.everyDays} days, ${repeat}]: ${oneLine(watch.about)}`);
      for (const row of watch.candidates) {
        if (listed >= BRIEF_CANDIDATES_MAX) break;
        lines.push(`    - ${row.table} ${row.ref} | ${clipTitle(row.title)}`);
        listed += 1;
      }
    }
  }
  return lines;
}

function timeOf(at: string | null): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clipTitle(text: string): string {
  const flat = oneLine(text);
  return flat.length > TITLE_CHARS ? `${flat.slice(0, TITLE_CHARS - 1).trimEnd()}…` : flat;
}

// ---------------------------------------------------------------------------
// Reading it from the database.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaReader = (schema: string) => SupabaseClient<any, string, any>;

/** Every active person on People with a rule that parses, with whether a cap holds them. */
export async function readRulePeople(
  you: YouSupabaseClient,
  userId: string,
  unreadBy: ReadonlySet<string>,
): Promise<RulePerson[]> {
  const { data, error } = await you
    .from('board_advisors')
    .select('id, key, name, reach_out_rule')
    .eq('user_id', userId)
    .eq('active', true)
    .not('reach_out_rule', 'is', null);
  if (error) throw new Error(`Reading the reach-out rules failed: ${error.message}`);
  const people: RulePerson[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const parsed = parseReachOutRule(row.reach_out_rule);
    if (!('rule' in parsed)) continue;
    const advisorId = String(row.id ?? '');
    people.push({
      advisorId,
      key: String(row.key ?? ''),
      name: String(row.name ?? ''),
      rule: parsed.rule,
      unread: unreadBy.has(advisorId),
    });
  }
  return people;
}

async function readSent(you: YouSupabaseClient, userId: string, advisorIds: string[]): Promise<Map<string, SentRef[]>> {
  const byAdvisor = new Map<string, SentRef[]>();
  if (advisorIds.length === 0) return byAdvisor;
  const { data, error } = await you
    .from('advisor_reach_outs')
    .select('advisor_id, watch_key, ref_table, ref_id, sent_at')
    .eq('user_id', userId)
    .in('advisor_id', advisorIds)
    .order('sent_at', { ascending: false })
    .limit(10000);
  if (error) throw new Error(`Reading what People have mentioned failed: ${error.message}`);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const advisorId = String(row.advisor_id ?? '');
    const list = byAdvisor.get(advisorId) ?? [];
    list.push({
      watchKey: String(row.watch_key ?? ''),
      refTable: String(row.ref_table ?? ''),
      refId: String(row.ref_id ?? ''),
      sentAt: String(row.sent_at ?? ''),
    });
    byAdvisor.set(advisorId, list);
  }
  return byAdvisor;
}

/** A filter that keeps a watch to live rows: `eq`, `neq`, or `is` null. */
export type WatchFilter = { column: string; op: 'eq' | 'neq' | 'is'; value: string | null };

/** How the due check reads one watchable table. */
export type WatchReader = {
  /** The table PostgREST reads, inside the watched table's schema. */
  from: string;
  /** The column naming the row's owner. */
  owner: string;
  /** The column a text names the row by (advisor_reach_outs.ref_id). */
  ref: string;
  /** The column the brief quotes as the row's title. */
  title: string;
  /** The column that says how new a row is. */
  newest: string;
  /** Rows the round should not name: dismissed, retired, archived. */
  filters?: readonly WatchFilter[];
};

/**
 * Watchable tables the sources catalogue does not list (lib/ask/list-rows.ts
 * LISTABLE), each read here by name. They are not sources because Goals
 * should not cite them, but a person on People may still talk about them: the
 * Jerwyn example watches you.insights and the builder example watches
 * plan_items and ideas (plan #2931). Every one is tied to its owner by
 * user_id, and the plan's and ideas' owner is the account that owns the app.
 */
export const EXTRA_WATCH_READERS: Readonly<Record<string, WatchReader>> = {
  'job_search.suggestions': {
    from: 'suggestions',
    owner: 'user_id',
    ref: 'id',
    title: 'headline',
    newest: 'created_at',
    filters: [{ column: 'status', op: 'neq', value: 'dismissed' }],
  },
  'you.insights': {
    from: 'insights',
    owner: 'user_id',
    ref: 'id',
    title: 'claim',
    newest: 'created_at',
    filters: [{ column: 'status', op: 'eq', value: 'shown' }],
  },
  // A step's change of status or due date is what a text about it says, so
  // updated_at is its clock.
  'goals.items': {
    from: 'items',
    owner: 'user_id',
    ref: 'id',
    title: 'title',
    newest: 'updated_at',
    filters: [{ column: 'archived_at', op: 'is', value: null }],
  },
  // A step shipping is an update, not a new row.
  'public.plan_items': {
    from: 'plan_items',
    owner: 'user_id',
    ref: 'id',
    title: 'title',
    newest: 'updated_at',
    filters: [{ column: 'status', op: 'neq', value: 'dropped' }],
  },
  'public.ideas': {
    from: 'ideas',
    owner: 'user_id',
    ref: 'id',
    title: 'body',
    newest: 'created_at',
    filters: [{ column: 'dismissed_at', op: 'is', value: null }],
  },
};

/**
 * How the due check reads a watched table: its own entry above, otherwise
 * the sources catalogue's, when list_rows can read it. Null for a table
 * neither knows, which a watch then reads nothing from.
 */
export function watchReaderFor(table: string): (WatchReader & { titleVia?: NonNullable<Source['titleVia']> }) | null {
  const extra = EXTRA_WATCH_READERS[table];
  if (extra) return extra;
  const source = listableSource(table);
  if (!source) return null;
  return {
    from: readableName(source),
    owner: ownerColumn(source) as string,
    ref: source.ref ?? 'id',
    title: source.title,
    newest: source.newest ?? 'created_at',
    ...(source.titleVia ? { titleVia: source.titleVia } : {}),
  };
}

/**
 * The person's rows in one watchable table, newest first, newer than
 * `since` when given. A table with no reader gives none.
 */
export async function readWatchRows(db: SchemaReader, userId: string, table: string, since: string | null): Promise<CandidateRow[]> {
  const reader = watchReaderFor(table);
  if (!reader) return [];
  const { ref: refColumn, newest, titleVia } = reader;
  const plain = [...new Set([refColumn, reader.title, newest])];
  const columns = titleVia ? [...plain, `${titleVia.embed}(${titleVia.column})`] : plain;
  let query = db(table.split('.')[0])
    .from(reader.from)
    .select(columns.join(', '))
    .eq(reader.owner, userId);
  for (const f of reader.filters ?? []) {
    query = f.op === 'eq' ? query.eq(f.column, f.value) : f.op === 'neq' ? query.neq(f.column, f.value) : query.is(f.column, null);
  }
  if (since) query = query.gt(newest, since);
  const { data, error } = await query.order(newest, { ascending: false }).limit(ROWS_READ);
  if (error) throw new Error(`${table}: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).flatMap((row) => {
    const ref = asText(row[refColumn]);
    if (!ref) return [];
    const title = (titleVia ? viaTitle(row, titleVia) : null) ?? asText(row[reader.title]) ?? ref;
    return [{ table, ref, title, at: asText(row[newest]) }];
  });
}

/**
 * Who is due by their rule now and free to write, read from the database. A table that cannot be read leaves that watch with
 * no candidates rather than failing the round.
 */
export async function loadReachOutDue(input: {
  you: YouSupabaseClient;
  db: SchemaReader;
  userId: string;
  unreadBy: ReadonlySet<string>;
  now: number;
}): Promise<{ people: RulePerson[]; due: DuePerson[]; heldBack: number }> {
  const { you, db, userId, now } = input;
  const people = await readRulePeople(you, userId, input.unreadBy);
  const sent = await readSent(
    you,
    userId,
    people.map((p) => p.advisorId),
  );
  const withWatches: (RulePerson & { watches: DueWatch[] })[] = [];
  for (const p of people) {
    const mine = sent.get(p.advisorId) ?? [];
    // Read every table a due watch names first, then decide from them.
    const read = new Map<string, CandidateRow[]>();
    for (const watch of p.rule.watches) {
      const clock = watchClock(watch, mine, now);
      if (!clock.due) continue;
      const rows: CandidateRow[] = [];
      for (const table of watch.tables) {
        try {
          rows.push(...(await readWatchRows(db, userId, table, clock.since)));
        } catch {
          // An unreadable table gives this watch nothing to say today.
        }
      }
      rows.sort((a, b) => timeOf(b.at) - timeOf(a.at));
      read.set(watch.key, rows);
    }
    const watches = dueWatchesOf({ person: p, sent: mine, rowsFor: (w) => read.get(w.key) ?? [], now });
    withWatches.push({ ...p, watches });
  }
  return { people, ...dueSummary(withWatches) };
}
