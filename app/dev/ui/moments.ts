/**
 * The moments (docs/UI-QUALITY-SPEC.md, Part 8).
 *
 * A moment is a designed response to something that matters: a day finished,
 * a goal closed, an offer. Each workspace has at most three, so they stay
 * noticeable, and a fourth is a decision for the person rather than a change
 * a session makes. tests/dev-ui-moments.test.ts holds this list to that, and
 * to every moment saying what it does under reduced motion.
 *
 * This is the catalogue /dev/ui lists, copied from the spec's table and kept
 * honest about what is built. A moment that is not built yet names the plan
 * step that builds it; one that is built names where it lives, and the demo
 * on /dev/ui where there is one.
 */

export type MomentWorkspace =
  | 'todo'
  | 'news'
  | 'home'
  | 'jobs'
  | 'goals'
  | 'learn'
  | 'shopping'
  | 'dash';

/** The order /dev/ui lists them in, with the name it shows. */
export const MOMENT_WORKSPACES: readonly (readonly [MomentWorkspace, string])[] = [
  ['todo', 'Todo'],
  ['news', 'News'],
  ['home', 'Home'],
  ['jobs', 'Jobs'],
  ['goals', 'Goals'],
  ['learn', 'Learn'],
  ['shopping', 'Shopping'],
  ['dash', 'Dash'],
];

export const MOMENTS_PER_WORKSPACE = 3;

export type MomentState =
  /** Built as the spec describes it. */
  | { built: 'yes'; where: string }
  /** Some of it is in the app; the rest is the step named. */
  | { built: 'partly'; where: string; step: number }
  /** None of it yet; the step named builds it. */
  | { built: 'no'; step: number };

export type Moment = {
  workspace: MomentWorkspace;
  name: string;
  /** What the person did, or what happened, that sets it off. */
  trigger: string;
  /** What they see, hear or feel. */
  sees: string;
  /** What is left under prefers-reduced-motion. It keeps what the moment tells them. */
  reducedMotion: string;
  state: MomentState;
  /** The id of the demo on /dev/ui that plays it, where one exists. */
  demo?: string;
};

export const MOMENTS: readonly Moment[] = [
  {
    workspace: 'todo',
    name: 'The day closing',
    trigger: 'Ticking the last item due today.',
    sees: 'The done items settle into a pile that folds shut, the day’s sigil draws in, and a line says how many were finished.',
    reducedMotion:
      'The pile is shown folded, the sigil is there at once, and the count is the same.',
    state: {
      built: 'partly',
      where:
        'The sigil draws in when the agenda or Open tasks is cleared on screen (QueueCleared in components/motion/clear.tsx). The pile and the count are not built.',
      step: 1556,
    },
    demo: 'motion-clear',
  },
  {
    workspace: 'news',
    name: 'The end of Quick read',
    trigger: 'Passing or reading the last story in Quick read.',
    sees: 'A line saying how many stories were read and how many skipped, and which one held attention longest.',
    reducedMotion: 'The same line, with no count-up.',
    state: {
      built: 'partly',
      where:
        'The deck ends with the sigil drawing in (app/news/quick/quick-view.tsx). The counts and the longest-held story are not built.',
      step: 1557,
    },
    demo: 'motion-clear',
  },
  {
    workspace: 'home',
    name: 'The first visit of the day',
    trigger: 'Opening Home for the first time on a new day.',
    sees: 'The greeting, the brief and Today arrive one after another rather than all at once.',
    reducedMotion: 'All three are there at once.',
    state: { built: 'no', step: 1558 },
  },
  {
    workspace: 'home',
    name: 'A finished day',
    trigger: 'Nothing due today is left.',
    sees: 'The day’s sigil sits beside the date.',
    reducedMotion: 'The sigil is there without drawing in.',
    state: { built: 'no', step: 1558 },
  },
  {
    workspace: 'jobs',
    name: 'A role moving forward',
    trigger: 'An application moving to a later stage.',
    sees: 'The role travels across the board to its new column and settles there.',
    reducedMotion: 'The role is in its new column, with the column’s name shown beside it.',
    state: { built: 'no', step: 1560 },
  },
  {
    workspace: 'jobs',
    name: 'An offer',
    trigger: 'An application reaching the offer stage.',
    sees: 'The one larger moment in Jobs, kept for the stage the rest of the board leads to. Its shape is for the step that builds it.',
    reducedMotion: 'The role is in Offer at once, marked as the offer.',
    state: { built: 'no', step: 1560 },
  },
  {
    workspace: 'jobs',
    name: 'A rejection',
    trigger: 'An application marked rejected.',
    sees: 'The role fades where it is, with no movement, and a line says how many applications are still open.',
    reducedMotion: 'The role goes at once, and the line is the same.',
    state: { built: 'no', step: 1560 },
  },
  {
    workspace: 'goals',
    name: 'A goal closing',
    trigger: 'Closing a goal on its page.',
    sees: 'One hexagon ring grows out of the status glyph, then the steps fold into one line.',
    reducedMotion: 'The solid hexagon and the folded line appear at once.',
    state: {
      built: 'yes',
      where: 'GoalGlyph and GoalStepsFold in app/goals/[goalId]/goal-close.tsx.',
    },
    demo: 'motion-goal-close',
  },
  {
    workspace: 'goals',
    name: 'A step Dash finished',
    trigger: 'A goal step closed by a Dash run appearing on the page.',
    sees: 'The step settles in, and Dash’s mark beside it flashes once.',
    reducedMotion: 'The step and the mark are simply there.',
    state: { built: 'no', step: 1561 },
  },
  {
    workspace: 'learn',
    name: 'A concept known',
    trigger: 'Marking a concept as known.',
    sees: 'The concept lights on the map and traces a line to each concept it unlocks.',
    reducedMotion: 'The concept and what it unlocks are lit at once.',
    state: { built: 'no', step: 1562 },
  },
  {
    workspace: 'shopping',
    name: 'A refund on time',
    trigger: 'A refund arriving inside its return window.',
    sees: 'The amount counts up into the year’s “saved by returning on time” figure.',
    reducedMotion: 'The figure shows its new total without counting.',
    state: { built: 'no', step: 1563 },
  },
  {
    workspace: 'dash',
    name: 'Dash at work',
    trigger: 'Asking Dash something, or a run it is doing.',
    sees: 'Its mark comes alive in the shape of the work, and each lookup appears in the thread as Dash makes it.',
    reducedMotion:
      'The mark holds the still shape for that kind of work, and the lookups still appear one by one.',
    state: {
      built: 'yes',
      where:
        'DashMark in components/ui/dash-mark.tsx, and the lookup lines in components/talk/lookup-lines.tsx.',
    },
  },
];

/** The workspaces holding more moments than the limit, with how many. */
export function overfullWorkspaces(
  moments: readonly Moment[],
  limit = MOMENTS_PER_WORKSPACE,
): { workspace: MomentWorkspace; count: number }[] {
  const counts = new Map<MomentWorkspace, number>();
  for (const moment of moments)
    counts.set(moment.workspace, (counts.get(moment.workspace) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > limit)
    .map(([workspace, count]) => ({ workspace, count }));
}
