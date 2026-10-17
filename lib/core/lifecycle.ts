import type { DevTone } from '@/components/dev/state-label';
import type { StatusGlyph } from '@/lib/status-glyphs';

/**
 * How a row ended, said one way everywhere (docs/ONE-INTERFACE-SPEC.md,
 * Part 4; plan #1957.1).
 *
 * Four words. Each workspace keeps the statuses its schema has (a goal is
 * `parked`, a track `shelved`, a reading `abandoned`) and maps them onto these
 * the way lib/core/move.ts maps statuses onto the five moves. Move says whose
 * turn it is; this says how a row ended, so a status that is not an ending
 * maps to `null` and the row is still open.
 *
 * - Done: it happened.
 * - Dropped: it will not happen, and that is a decision. Someone chose
 *   against it, or the thing it was about went away.
 * - Later: not now. It comes back, on a day or when asked for.
 * - Declined: a proposal turned down. Only ever something offered to the
 *   person (Dash's suggestion, a recommended role, an edit to a vision), never
 *   the person's own task or note, which they Drop.
 */
export const LIFECYCLES = ['done', 'dropped', 'later', 'declined'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** The word a row that ended this way wears. */
export const LIFECYCLE_WORD: Record<Lifecycle, string> = {
  done: 'Done',
  dropped: 'Dropped',
  later: 'Later',
  declined: 'Declined',
};

/** The word on the button that ends a row this way. */
export const LIFECYCLE_VERB: Record<Lifecycle, string> = {
  done: 'Done',
  dropped: 'Drop',
  later: 'Later',
  declined: 'Decline',
};

/**
 * The glyph each ending draws (lib/status-glyphs.ts), the ones the workspaces
 * already use for it: the tick a finished task takes, the struck hexagon a
 * withdrawal takes, the clock for a row put down until a day, and the cross.
 */
export const LIFECYCLE_GLYPH: Record<Lifecycle, StatusGlyph> = {
  done: 'check',
  dropped: 'slash',
  later: 'clock',
  declined: 'cross',
};

export const LIFECYCLE_TONE: Record<Lifecycle, DevTone> = {
  done: 'positive',
  dropped: 'ghost',
  later: 'info',
  declined: 'quiet',
};

/** What each ending means, for a tooltip. */
export const LIFECYCLE_TITLE: Record<Lifecycle, string> = {
  done: 'It happened.',
  dropped: 'It will not happen, and that was decided.',
  later: 'Not now. It comes back.',
  declined: 'A suggestion you turned down.',
};

/** Word, glyph, tone and tooltip together, for what draws an ending. */
export function lifecycleLabel(lifecycle: Lifecycle): {
  lifecycle: Lifecycle;
  word: string;
  verb: string;
  glyph: StatusGlyph;
  tone: DevTone;
  title: string;
} {
  return {
    lifecycle,
    word: LIFECYCLE_WORD[lifecycle],
    verb: LIFECYCLE_VERB[lifecycle],
    glyph: LIFECYCLE_GLYPH[lifecycle],
    tone: LIFECYCLE_TONE[lifecycle],
    title: LIFECYCLE_TITLE[lifecycle],
  };
}

/**
 * What the toast says once a row has closed (plan #1957.8): the ending, then
 * the row it closed, as in "Dropped: Book the boiler service". The toast cuts
 * a long name off at its edge, so the name goes in whole. With no name to
 * hand the ending stands alone.
 */
export function closedToast(lifecycle: Lifecycle, name?: string | null): string {
  const title = name?.replace(/\s+/g, ' ').trim();
  return title ? `${LIFECYCLE_WORD[lifecycle]}: ${title}` : LIFECYCLE_WORD[lifecycle];
}

/** One status word's ending: a word of the four, or `null` while the row is still open. */
export type Ending = Lifecycle | null;

/**
 * Where a status vocabulary is declared, so tests/lifecycle-words.test.ts can
 * read it back from the migrations and compare it with `words`.
 *
 * `dir` is the folder under supabase/, `name` the enum type or the check
 * constraint that holds the words. A status added to the schema without a
 * line here fails that test.
 */
export type LifecycleSource = {
  dir: string;
  kind: 'enum' | 'check';
  name: string;
  words: Record<string, Ending>;
};

/**
 * Every status vocabulary in the schemas that can end a row. Each key is
 * `schema.table.column`, the way the rest of the app names a column.
 */
export const LIFECYCLE_SOURCES = {
  // The person's own tasks: they Drop what they decide against.
  'todo.tasks.status': {
    dir: 'migrations-todo',
    kind: 'enum',
    name: 'task_status',
    words: { open: null, done: 'done', dropped: 'dropped' },
  },
  // `parked` is a goal put down for now.
  'goals.items.status': {
    dir: 'migrations-goals',
    kind: 'check',
    name: 'items_status_ck',
    words: {
      proposed: null,
      open: null,
      blocked: null,
      parked: 'later',
      done: 'done',
      dropped: 'dropped',
    },
  },
  'public.plan_items.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'plan_items_status_ck',
    words: {
      proposed: null,
      not_started: null,
      in_progress: null,
      blocked: null,
      done: 'done',
      dropped: 'dropped',
    },
  },
  // A note is the person's own, so one Dash will not act on is Dropped.
  'public.feedback_items.status': {
    dir: 'migrations',
    kind: 'enum',
    name: 'feedback_status',
    words: {
      open: null,
      planned: null,
      in_progress: null,
      blocked: null,
      done: 'done',
      declined: 'dropped',
    },
  },
  'learn.readings.status': {
    dir: 'migrations-learn',
    kind: 'enum',
    name: 'reading_status',
    words: { queued: null, reading: null, read: 'done', abandoned: 'dropped' },
  },
  'learn.tracks.status': {
    dir: 'migrations-learn',
    kind: 'enum',
    name: 'track_status',
    words: { active: null, done: 'done', shelved: 'later' },
  },
  'learn.goals.status': {
    dir: 'migrations-learn',
    kind: 'enum',
    name: 'goal_status',
    words: { proposed: null, active: null, reached: 'done', abandoned: 'dropped' },
  },
  // Cards are Dash's picks. `dropped` is Dash withdrawing one that did not
  // match; `dismissed` (Not interested) and `passed` (Next) turn one down.
  // `review` and `skipped` come back after two and three days.
  'learn.feed_cards.status': {
    dir: 'migrations-learn',
    kind: 'check',
    name: 'feed_cards_status_ck',
    words: {
      picked: null,
      ready: null,
      opened: null,
      saved: 'done',
      tested: 'done',
      known: 'done',
      review: 'later',
      skipped: 'later',
      dropped: 'dropped',
      dismissed: 'declined',
      passed: 'declined',
    },
  },
  'public.saved_items.status': {
    dir: 'migrations',
    kind: 'enum',
    name: 'saved_item_status',
    words: { saved: null, purchased: 'done', dismissed: 'dropped' },
  },
  // Recommended roles and the like are Dash's suggestions; one that lapsed
  // unanswered counts as not taken.
  'job_search.suggestions.status': {
    dir: 'migrations-job-search',
    kind: 'check',
    name: 'suggestions_status_ck',
    words: { open: null, done: 'done', dismissed: 'declined', expired: 'declined' },
  },
  'public.check_backs.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'check_backs_status_ck',
    words: { waiting: null, done: 'done', dropped: 'dropped' },
  },
  // Takeaways are what Dash drew from a video; covered and crafted mean the
  // takeaway became an idea or a step.
  'public.inspiration_takeaways.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'inspiration_takeaways_status_ck',
    words: { open: null, covered: 'done', crafted: 'done', dismissed: 'declined' },
  },
  // Margin notes are raised by Dash's check. `detached` is a note whose text
  // was edited away.
  'learn.essay_notes.status': {
    dir: 'migrations-learn',
    kind: 'check',
    name: 'essay_notes_status_check',
    words: { open: null, waiting: null, done: 'done', dismissed: 'declined', detached: 'dropped' },
  },
  // `undone` is a change that was made and then taken back.
  'core.dash_actions.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'dash_actions_status_ck',
    words: { proposed: null, done: 'done', declined: 'declined', undone: 'dropped' },
  },
  // An employer turning an application down is the one declined thing the
  // person did not offer to anyone; the rest of the ending states are theirs
  // or the role's, and are Dropped.
  'job_search.applications.status': {
    dir: 'migrations-job-search',
    kind: 'enum',
    name: 'application_status',
    words: {
      lead: null,
      drafting: null,
      submitted: null,
      acknowledged: null,
      in_process: null,
      final_round: null,
      offer: null,
      rejected: 'declined',
      withdrawn: 'dropped',
      ghosted: 'dropped',
      role_closed: 'dropped',
    },
  },

  // Not on the first list, and the same shape.
  'public.raised_items.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'raised_items_status_ck',
    words: { open: null, answered: null, closed: 'done', dismissed: 'declined' },
  },
  'public.social_posts.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'social_posts_status_ck',
    words: { suggested: null, planned: null, posted: 'done', dropped: 'dropped' },
  },
  'public.spec_changes.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'spec_changes_status_ck',
    words: { proposed: null, approved: null, applied: 'done', declined: 'declined' },
  },
  'public.spec_interviews.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'spec_interviews_status_ck',
    words: { open: null, drafted: 'done', abandoned: 'dropped' },
  },
  'public.vision_reviews.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'vision_reviews_status_ck',
    words: { pending: null, accepted: 'done', dismissed: 'declined' },
  },
  'public.ui_findings.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'ui_findings_status_ck',
    words: { open: null, confirmed: null, dismissed: 'declined' },
  },
  'goals.context.status': {
    dir: 'migrations-goals',
    kind: 'check',
    name: 'context_status_ck',
    words: { proposed: null, kept: 'done', dismissed: 'declined' },
  },
  'job_search.learning_tracks.status': {
    dir: 'migrations-job-search',
    kind: 'check',
    name: 'learning_tracks_status_ck',
    words: { proposed: null, started: 'done', dismissed: 'declined' },
  },
  'public.recurring_payments.status': {
    dir: 'migrations',
    kind: 'check',
    name: 'recurring_payments_status_ck',
    words: { active: null, cancelled: 'done', ignored: 'dropped' },
  },
  'todo.appointments.status': {
    dir: 'migrations-todo',
    kind: 'check',
    name: 'appointments_status_ck',
    words: { booked: null, cancelled: 'dropped' },
  },
  'job_search.interviews.status': {
    dir: 'migrations-job-search',
    kind: 'enum',
    name: 'interview_status',
    words: { scheduled: null, rescheduled: null, completed: 'done', cancelled: 'dropped' },
  },
} as const satisfies Record<string, LifecycleSource>;

export type LifecycleSourceId = keyof typeof LIFECYCLE_SOURCES;

/**
 * Status vocabularies in the migrations that do not end a row the person
 * works, with why. The test fails on a vocabulary in neither this list nor
 * LIFECYCLE_SOURCES, so a new one is decided when it is added.
 */
export const NOT_A_CLOSING_STATUS: Record<string, string> = {
  email_account_status: 'connection state of a mailbox',
  sync_job_status: 'state of a background sync',
  sync_run_status: 'state of a background sync',
  vault_connection_status: 'connection state of a vault',
  parse_status: 'whether an email was read',
  topics_status_ck: 'whether a topic is still a draft or approved to ask about',
  graph_moves_status_ck: 'whether a claims-graph subject has been moved onto topics',
  recurring_messages_status_ck: 'whether an email was read',
  appointment_messages_status_ck: 'whether an email was read',
  order_status: 'where an order is in the post',
  shipment_status: 'where a parcel is in the post',
  return_status: 'where a return is in the post',
  inventory_status: 'what became of something owned, not a task',
  share_link_status: 'whether a link is live',
  company_status: 'whether anything is happening with a company',
  contact_status: 'how far a conversation has got',
  posting_status: 'whether a job posting is still up',
  answer_status: 'where a drafted answer is',
  quiz_status: 'how much of a quiz is answered',
  tension_status: 'a contradiction the vault found, settled by the notes',
  plan_runs_status_ck: 'state of a Dash run',
  company_research_status_ck: 'state of a Dash research run',
  runs_status_ck: 'state of a Dash run',
  watches_status_ck: 'state of a Dash watch',
  dash_handoffs_status_ck: 'state of a hand-off to Dash',
  briefs_status_check: 'state of a research run',
  subject_preparations_status_ck: 'state of a subject\'s preparation run',
  subject_preparation_steps_status_ck: 'state of a step in a subject\'s preparation run',
  video_transcripts_state_ck: 'state of a transcript fetch',
  inspiration_videos_transcript_state_ck: 'state of a transcript fetch',
  knowledge_state: 'how well something is known, a ladder with no ending',
  x_accounts_status_ck: 'connection state of an account',
  map_sweeps_status_ck: 'state of a vault sweep',
};

type Mapper = (status: string) => Ending;

function mapperFor(id: LifecycleSourceId): Mapper {
  const words: Record<string, Ending> = LIFECYCLE_SOURCES[id].words;
  return (status) => words[status] ?? null;
}

/**
 * How a row with this status ended, or `null` while it is still open or the
 * status is not one this knows. `source` is `schema.table.column`.
 */
export function lifecycleOf(source: LifecycleSourceId, status: string): Ending {
  return mapperFor(source)(status);
}

/** One function per workspace, for call sites that know which they are in. */
export const taskLifecycle = mapperFor('todo.tasks.status');
export const goalItemLifecycle = mapperFor('goals.items.status');
export const planItemLifecycle = mapperFor('public.plan_items.status');
export const feedbackLifecycle = mapperFor('public.feedback_items.status');
export const readingLifecycle = mapperFor('learn.readings.status');
export const trackLifecycle = mapperFor('learn.tracks.status');
export const learnGoalLifecycle = mapperFor('learn.goals.status');
export const feedCardLifecycle = mapperFor('learn.feed_cards.status');
export const savedItemLifecycle = mapperFor('public.saved_items.status');
export const suggestionLifecycle = mapperFor('job_search.suggestions.status');
export const checkBackLifecycle = mapperFor('public.check_backs.status');
export const takeawayLifecycle = mapperFor('public.inspiration_takeaways.status');
export const essayNoteLifecycle = mapperFor('learn.essay_notes.status');
export const dashActionLifecycle = mapperFor('core.dash_actions.status');
export const applicationLifecycle = mapperFor('job_search.applications.status');
