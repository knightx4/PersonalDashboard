import type { ModuleId } from '@/lib/modules';

/**
 * A source is something that knows about obligations this module does not own.
 *
 * The rule the whole registry serves: **an obligation is displayed by whoever
 * needs to show it and written by whoever owns it.** A source reads its
 * workspace at query time and returns what it found. It never copies a row into
 * `todo`, so there is no import job, nothing to reconcile, and nothing that can
 * outlive the thing it describes.
 *
 * The agenda page knows about this interface and the registry. It does not know
 * that Gmail, git or a return window exist. Adding a source later is one file
 * and one entry.
 *
 * Types only, and no `server-only`: the settings page renders the list of
 * sources and needs their names.
 */

/** Every source that exists. Off unless the account says otherwise. */
export const SOURCE_IDS = ['job_reminders', 'return_deadlines'] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

/** What a source item can point at, so the page can offer the right link. */
export interface AgendaItemLink {
  href: string;
  label: string;
}

/**
 * One thing on the agenda that came from a source.
 *
 * Deliberately not a Task. A return deadline cannot be completed, a reminder
 * completes on someone else's row, and flattening all three into one editable
 * shape is the first step towards copying them here.
 */
export interface AgendaItem {
  /** Unique within the source. Also the key its deferral is stored against. */
  key: string;
  source: SourceId;
  title: string;
  /** A calendar day, YYYY-MM-DD. What the item sorts by. */
  day: string;
  /** An instant, when the item has a clock rather than only a day. */
  at: string | null;
  /** Where to go to actually deal with it. */
  link: AgendaItemLink | null;
  /** A second, task-specific action -- the follow-up composer, say. */
  action: AgendaItemLink | null;
  /** Extra context, shown quietly beside the title. */
  detail: string | null;
  /**
   * Whether this can be finished at all. A return deadline is a date, not a
   * task: it stops mattering when the return exists or the day passes, and
   * neither of those is a button.
   */
  completable: boolean;
}

/**
 * What a source is told, so it never has to ask.
 *
 * The window is a pair of calendar days in the reader's own zone, computed
 * once by the caller. A source that worked out "today" for itself would be a
 * second place the timezone rule could be got wrong.
 */
export interface SourceContext {
  userId: string;
  timezone: string;
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD. */
  to: string;
  now: Date;
}

/**
 * Something already in a day that is not a task.
 *
 * An interview is an appointment: you do not tick it off, and putting a
 * checkbox beside one would be inviting a person to lie to their own list. It
 * belongs on the agenda as context -- what is already in this day -- and
 * nothing more.
 */
export interface DayContext {
  key: string;
  /** A calendar day, YYYY-MM-DD, in the reader's zone. */
  day: string;
  at: string | null;
  label: string;
  detail: string | null;
  link: AgendaItemLink | null;
}

export interface AgendaSource {
  id: SourceId;
  label: string;
  /** Which workspace this reads. An off module's sources never run. */
  module: ModuleId;
  /** One line, shown beside the switch. Say what appears, not how it works. */
  description: string;
  /** Everything this source has for the window. */
  fetch(ctx: SourceContext): Promise<AgendaItem[]>;
  /** Appointments in the window, shown as day context rather than as items. */
  context?(ctx: SourceContext): Promise<DayContext[]>;
  /** "Done", where the source can express it. */
  complete?(ctx: SourceContext, key: string): Promise<void>;
  /** "Later", by however this source defers things. */
  defer(ctx: SourceContext, key: string): Promise<void>;
  /** "Not this one", for good. */
  dismiss(ctx: SourceContext, key: string): Promise<void>;
}
