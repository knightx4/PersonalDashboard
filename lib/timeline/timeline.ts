import type { ModuleId } from '@/lib/modules';
import { sourceHref } from '@/lib/sources/catalogue';
import { noteHref } from '@/lib/vault/paths';
import { stepHref } from '@/lib/goals/all-goals';

/**
 * One timeline of what you did across the modules (plan #1117): the rows of
 * the core.timeline view, which reads them from the tables each module
 * already keeps (supabase/migrations-goals/0053_timeline.sql). Nothing is
 * recorded for it.
 */

/** The modules the timeline reads, in the order the page lists them. */
export const TIMELINE_MODULES = ['shopping', 'jobs', 'todo', 'vault', 'learn', 'goals'] as const satisfies readonly ModuleId[];

export type TimelineModule = (typeof TIMELINE_MODULES)[number];

/** What happened, per module. The view's `kind` column holds one of these. */
export const TIMELINE_KINDS = {
  shopping: ['ordered', 'returned'],
  jobs: ['applied', 'rejected', 'offer', 'withdrew', 'interviewed'],
  todo: ['task_done'],
  vault: ['note_written'],
  learn: ['probe_answered', 'placement_answered', 'quiz_answered', 'reading_finished'],
  goals: ['step_done', 'goal_done'],
} as const satisfies Record<TimelineModule, readonly string[]>;

export type TimelineKind = (typeof TIMELINE_KINDS)[TimelineModule][number];

/** How a count of each kind reads: "12 orders", "3 rejections". */
export const KIND_NOUNS: Record<TimelineKind, { one: string; many: string }> = {
  ordered: { one: 'order', many: 'orders' },
  returned: { one: 'return', many: 'returns' },
  applied: { one: 'application', many: 'applications' },
  rejected: { one: 'rejection', many: 'rejections' },
  offer: { one: 'offer', many: 'offers' },
  withdrew: { one: 'withdrawal', many: 'withdrawals' },
  interviewed: { one: 'interview', many: 'interviews' },
  task_done: { one: 'task done', many: 'tasks done' },
  note_written: { one: 'note', many: 'notes' },
  probe_answered: { one: 'check answered', many: 'checks answered' },
  placement_answered: { one: 'placement answer', many: 'placement answers' },
  quiz_answered: { one: 'quiz answer', many: 'quiz answers' },
  reading_finished: { one: 'reading finished', many: 'readings finished' },
  step_done: { one: 'goal step done', many: 'goal steps done' },
  goal_done: { one: 'goal reached', many: 'goals reached' },
};

/** "12 orders", "1 rejection". */
export function kindCount(kind: TimelineKind, count: number): string {
  const noun = KIND_NOUNS[kind];
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/** One row of core.timeline. */
export type TimelineEvent = {
  occurred_at: string;
  module: TimelineModule;
  kind: TimelineKind;
  /** The thing it happened to, as a list names it. */
  title: string;
  /** A short second line: the stage a rejection reached, the goal a step sits under. */
  detail: string | null;
  /** Money moved, for orders and refunds. */
  amount_cents: number | null;
  currency: string | null;
  /** `schema.table` of the row that records the event. */
  source_table: string;
  /** That row's id. With source_table, the evidence a later step cites. */
  source_id: string;
  /** What the link is built from; see timelineHref. */
  link_ref: string | null;
  /**
   * The row that records it, as `schema.table:id` (lib/core/refs.ts): the
   * same string as eventRef, carried on the event so it can be linked,
   * commented on or handed to Dash like any other row.
   */
  ref: string;
};

/** One row as core.timeline returns it, before withRefs adds the ref. */
export type TimelineRow = Omit<TimelineEvent, 'ref'>;

/** The columns read from core.timeline, in the view's order. */
export const TIMELINE_COLUMNS =
  'occurred_at, module, kind, title, detail, amount_cents, currency, source_table, source_id, link_ref';

/** A stable key for one event, and the form an observation cites it in. */
export function eventRef(event: Pick<TimelineEvent, 'source_table' | 'source_id'>): string {
  return `${event.source_table}:${event.source_id}`;
}

/**
 * The rows of a core.timeline read as events, each with its ref. Computed
 * here from source_table and source_id rather than in the view, which every
 * reader already selects those two from.
 */
export function withRefs(rows: readonly TimelineRow[]): TimelineEvent[] {
  return rows.map((row) => ({ ...row, ref: eventRef(row) }));
}

/**
 * Where an event opens in the app. The catalogue's href is used wherever the
 * table the link points at has one (lib/sources/catalogue.ts); the rest are
 * the pages that show those rows, which the catalogue does not list because
 * Goals does not read them as sources.
 */
export function timelineHref(event: Pick<TimelineEvent, 'source_table' | 'source_id' | 'link_ref'>): string {
  const ref = event.link_ref;
  switch (event.source_table) {
    case 'public.orders':
      return `/shopping/orders/${event.source_id}`;
    case 'public.returns':
      return '/shopping/returns';
    case 'job_search.application_events':
    case 'job_search.interviews':
      return ref ? (sourceHref('job_search.roles', ref) ?? '/jobs/pipeline') : '/jobs/pipeline';
    case 'todo.tasks':
      return sourceHref('todo.tasks', event.source_id) ?? '/todo/all';
    case 'obsidian.notes':
      return ref ? noteHref(ref) : '/vault';
    case 'learn.probes':
      return ref ? (sourceHref('learn.concepts', ref) ?? '/learn') : '/learn';
    case 'learn.opening_questions':
      return ref ? (sourceHref('learn.subjects', ref) ?? '/learn') : '/learn';
    case 'learn.quiz_questions':
      return ref ? (sourceHref('learn.quizzes', ref) ?? '/learn') : '/learn';
    case 'learn.readings':
      return sourceHref('learn.readings', event.source_id) ?? '/learn';
    case 'goals.items':
      if (!ref) return '/goals/all';
      return ref === event.source_id ? `/goals/${ref}` : stepHref(ref, event.source_id);
    default:
      return '/';
  }
}
