/**
 * The weekly run and what it suggests (docs/GOALS-SPEC.md, "What Claude does,
 * and when"; plan #934).
 *
 * Once a week the daily cron fires the goals routine to research the help
 * each open goal asks for (its help_kinds: events, volunteer openings,
 * reading, courses, job leads; plan #1027 and #1028). The routine writes each
 * find to goals.suggestions with its kind and a link, and a date when it has
 * one. You press going or not for me on the Goals home; going puts it on
 * Todo on its date, and ticking it there records that you went. A suggestion
 * nobody reacted to within the week is marked ignored. The next week's brief
 * lists every reaction from the last few weeks under its kind, so the
 * research for each kind follows what you picked of that kind.
 *
 * The rules that need no database live here. The reads and writes are in
 * lib/goals/suggestions-store.ts, and the cron stage is inngest/goals/weekly.ts.
 */
import { HELP_KINDS, isHelpKind, type HelpKind, type HelpKindChoice } from '@/lib/goals/help-kinds';
import type { LiveRhythm } from '@/lib/goals/rhythms';
import { reviewLines, type ReviewGoal } from '@/lib/goals/reviews';
import type { Goal } from '@/lib/goals/tree';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long after one weekly run another is refused. A few hours short of a
 * week, so the cron that fires a little early on the seventh day still runs
 * and a retried cron on any other day does not spend a second run.
 */
export const WEEKLY_GAP_MS = 7 * DAY_MS - 4 * HOUR_MS;

/**
 * How long a suggestion waits for a reaction before it is marked ignored.
 * The same as the gap, so last week's suggestions are closed on the morning
 * this week's run starts, and its brief reads them as ignored.
 */
export const IGNORED_AFTER_MS = WEEKLY_GAP_MS;

/** How far back the brief reads reactions, and the most it lists. */
export const PAST_WEEKS = 8;
export const PAST_LIMIT = 80;

/** How long a suggestion stays on the home after it was written. */
export const SHOWN_FOR_MS = 14 * DAY_MS;

export const REACTIONS = ['going', 'not_for_me', 'ignored'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** The two you can press. Ignored is written by the weekly run. */
export const YOUR_REACTIONS = ['going', 'not_for_me'] as const;
export type YourReaction = (typeof YOUR_REACTIONS)[number];

export const REACTION_LABELS: Record<Reaction, string> = {
  going: 'Going',
  not_for_me: 'Not for me',
  ignored: 'No answer',
};

export type Suggestion = {
  id: string;
  itemId: string | null;
  /** The kind of help it is. Rows from before plan #1028 were all events. */
  kind: HelpKind;
  title: string;
  detail: string | null;
  url: string | null;
  place: string | null;
  source: string | null;
  /** YYYY-MM-DD, or null when it has no one date (a volunteer opening, say). */
  happensOn: string | null;
  startsAt: string | null;
  reaction: Reaction | null;
  attended: boolean | null;
  createdAt: string;
};

export type SuggestionRow = {
  id: string;
  item_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  url: string | null;
  place: string | null;
  source: string | null;
  happens_on: string | null;
  starts_at: string | null;
  reaction: string | null;
  attended: boolean | null;
  created_at: string;
};

export const SUGGESTION_COLUMNS =
  'id, item_id, kind, title, detail, url, place, source, happens_on, starts_at, reaction, attended, created_at';

export function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: isHelpKind(row.kind) ? row.kind : 'events',
    title: row.title,
    detail: row.detail,
    url: row.url,
    place: row.place,
    source: row.source,
    happensOn: row.happens_on,
    startsAt: row.starts_at,
    reaction: (REACTIONS as readonly string[]).includes(row.reaction ?? '')
      ? (row.reaction as Reaction)
      : null,
    attended: row.attended,
    createdAt: row.created_at,
  };
}

export function parseYourReaction(value: unknown): YourReaction | null {
  return (YOUR_REACTIONS as readonly unknown[]).includes(value) ? (value as YourReaction) : null;
}

/** Whether a weekly run was started recently enough that this week's is done. */
export function ranThisWeek(lastWeeklyRunAt: string | null, now: number): boolean {
  if (!lastWeeklyRunAt) return false;
  return now - Date.parse(lastWeeklyRunAt) < WEEKLY_GAP_MS;
}

/** Suggestions written before this instant and still unanswered are ignored. */
export function ignoredBefore(now: number): string {
  return new Date(now - IGNORED_AFTER_MS).toISOString();
}

/** The oldest suggestion the brief reads reactions from. */
export function pastSince(now: number): string {
  return new Date(now - PAST_WEEKS * 7 * DAY_MS).toISOString();
}

/**
 * What the home lists: this fortnight's suggestions you have not turned down
 * and that have not already happened, soonest first, undated ones last.
 * Ignored ones stay, so a late going still counts.
 */
export function homeSuggestions(all: Suggestion[], today: string): Suggestion[] {
  return all
    .filter((s) => s.reaction !== 'not_for_me' && s.attended === null)
    .filter((s) => s.happensOn === null || s.happensOn >= today)
    .sort((a, b) => {
      if (a.happensOn !== b.happensOn) {
        if (a.happensOn === null) return 1;
        if (b.happensOn === null) return -1;
        return a.happensOn < b.happensOn ? -1 : 1;
      }
      return (a.startsAt ?? '').localeCompare(b.startsAt ?? '');
    });
}

/**
 * What going puts on Todo: each suggestion you said you are going to and have
 * not ticked, on its date. One whose date has passed leaves Todo rather than
 * piling up (the spec's "Coming back after time away"); an undated one stays
 * until it is ticked or dismissed. `to` is the last day of the agenda window.
 */
export function todoSuggestions(all: Suggestion[], today: string, to: string): Suggestion[] {
  return all.filter(
    (s) =>
      s.reaction === 'going' &&
      s.attended === null &&
      (s.happensOn === null || (s.happensOn >= today && s.happensOn <= to)),
  );
}

function when(s: Pick<Suggestion, 'happensOn' | 'startsAt'>): string | null {
  if (s.startsAt) return s.startsAt.slice(0, 16).replace('T', ' ');
  return s.happensOn;
}

/** One line of the brief for a past suggestion and what you did with it. */
export function pastLine(s: Suggestion): string {
  const reaction = s.reaction ?? 'no answer yet';
  const went = s.attended === true ? ', and went' : s.attended === false ? ', and did not go' : '';
  const facts = [s.source, s.place, when(s)].filter(Boolean).join(', ');
  return `- ${reaction}${went}: "${s.title}"${facts ? ` (${facts})` : ''}`;
}

/** A goal the weekly run researches for: open, and asking for at least one kind of help. */
export type HelpGoal = {
  id: string;
  title: string;
  helpKinds: HelpKindChoice[];
  /** Its live rhythms, which an event or a volunteer opening can count towards. */
  rhythms: LiveRhythm[];
};

/**
 * The goals the weekly run researches for, in tree order. A goal that asks
 * for nothing is left out, rhythms or not: the kinds on the goal are what
 * decide the research (plan #1026).
 */
export function helpGoals(goals: Goal[], rhythms: LiveRhythm[]): HelpGoal[] {
  return goals
    .filter((g) => g.status === 'open' && (g.helpKinds ?? []).length > 0)
    .map((g) => ({
      id: g.id,
      title: g.title,
      helpKinds: g.helpKinds ?? [],
      rhythms: rhythms.filter((r) => r.goalId === g.id),
    }));
}

/** The kinds any of these goals ask for, in the fixed order of HELP_KINDS. */
export function kindsAskedFor(goals: HelpGoal[]): HelpKind[] {
  const asked = new Set(goals.flatMap((g) => g.helpKinds.map((h) => h.kind)));
  return HELP_KINDS.filter((kind) => asked.has(kind));
}

/**
 * The turn appended to the goals routine's standing prompt for the weekly
 * run. It names the account and the run row already written, then every open
 * goal to review against its done-when (plan #1018), then each goal with the
 * kinds of help it asks for, and under each kind asked for, every reaction to
 * that kind from the last few weeks. A week when no goal asks for help is a
 * review and nothing else.
 */
export function weeklyRunText(input: {
  userId: string;
  runId: string;
  review: ReviewGoal[];
  goals: HelpGoal[];
  past: Suggestion[];
}): string {
  const review = input.review.flatMap((g) => [...reviewLines(g), '']);
  const goals = input.goals.flatMap((g) => [
    `Goal "${g.title}" (goals.items id ${g.id}) asks for:`,
    ...g.helpKinds.map(({ kind, note }) => `- ${kind}${note ? `: ${note}` : ''}`),
    ...(g.rhythms.length > 0
      ? [
          'Its live rhythms:',
          ...g.rhythms.map((r) => `- "${r.title}" (goals.items id ${r.id}), ${r.target} a ${r.period}`),
        ]
      : []),
    '',
  ]);
  const past = kindsAskedFor(input.goals).flatMap((kind) => {
    const lines = input.past.filter((s) => s.kind === kind).map(pastLine);
    return [
      `${kind}:`,
      ...(lines.length > 0
        ? lines
        : ['- Nothing yet for this kind. Suggest a spread, so the reactions teach something.']),
      '',
    ];
  });
  const research =
    input.goals.length > 0
      ? [
          'Then find the help each goal below asks for, one kind at a time.',
          '',
          ...goals,
          'What you suggested before of each kind, and what the person did with it (newest first):',
          '',
          ...past,
          'Follow .claude/skills/goals/SKILL.md, the section "The weekly run", and its part for each',
          'kind. Write each find to goals.suggestions with kind set to the kind it answers, a link,',
          'and item_id set to the goal it is for, or to the rhythm it counts towards when it is an',
          'event or a volunteer opening for a goal with one. Within each kind, lean towards what was',
          'marked going and away from what was marked not for me or left without an answer. Never',
          "write a reaction or attended: those are the person's.",
          '',
        ]
      : ['No goal asks for weekly help this week, so there is nothing to research.', ''];
  return [
    'The weekly run. First, review every open goal below against its done-when: one row in',
    'goals.reviews each, with a verdict of on_track, stalled or waiting_on_you, one sentence on',
    'why and one on the next move. A stalled goal also gets that next move as a proposed step',
    'under it, named in the review as step_id. Follow .claude/skills/goals/SKILL.md, "Reviewing',
    'each goal".',
    '',
    ...review,
    ...research,
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started. Set goals.run_id to it, and run_id on every review and',
    'suggestion, and close that row with a summary (or as failed, with the reason) before you stop.',
  ].join('\n');
}
