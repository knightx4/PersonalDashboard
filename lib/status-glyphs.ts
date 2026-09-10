/**
 * One shape per state, so a state is readable with the colour taken away.
 *
 * Law 4 tells whoever draws the next surface to use "ink and a shape" and
 * never says anywhere what the shapes are. These are them: a glyph for each of
 * the eleven application statuses, each of the three task states, and each of
 * the ten states a plan step can be in. The names are shapes rather than
 * statuses, because components/ui/status-glyph.tsx draws them and knows
 * nothing about pipelines, todo lists or plans.
 *
 * The vocabulary is Linear's — an outline at the start of a ladder, the shape
 * filled further as it advances, solid at the top, struck when it ended badly
 * — drawn as hexagons instead of circles. The 2026 redraw took every arc and
 * circle out of the mark set on purpose (components/ui/module-mark.tsx), so a
 * set of rings would have been the only round shapes in the app.
 *
 * This lives at the root of lib/ beside modules.ts and density.ts because it
 * crosses three workspaces. Neither lib/jobs, lib/todo nor lib/plan owns it.
 */
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { PlanHealth } from '@/lib/plan/tree';
import type { TaskStatus } from '@/lib/todo/tasks/model';

/**
 * The whole vocabulary. Five fill levels for a rung on a ladder, and six
 * marks for a state that is not on one.
 *
 * `question` is the one letterform in the set. It was added for a plan step
 * nobody has answered yet, which is a state no geometric mark said: the empty
 * hexagon already means "nothing has happened to this", and a question waiting
 * on you is the opposite of that.
 */
export const STATUS_GLYPHS = [
  'empty',
  'quarter',
  'half',
  'three-quarters',
  'full',
  'check',
  'cross',
  'slash',
  'bar',
  'dashed',
  'question',
] as const;

export type StatusGlyph = (typeof STATUS_GLYPHS)[number];

/**
 * The pipeline, as fractions of a hexagon and four ways of striking one.
 *
 * A `Record` rather than a lookup with a fallback: a twelfth status added to
 * APPLICATION_STATUSES fails the typecheck here instead of quietly drawing
 * itself as a lead.
 *
 * Two pairs share a shape, and both share a hue already: `lead` and `drafting`
 * are the two states where nothing has been sent, and `submitted` and
 * `acknowledged` read as one word on the badge because nearly every row is
 * created from a confirmation email. The pairs that stop sharing are the
 * interesting half — `withdrawn` borrows the lead tint and `role_closed`
 * borrows the ghosted one, and a struck hexagon says what those tints cannot:
 * that you pulled out, and that the role went away without anyone judging you.
 */
export const APPLICATION_STATUS_GLYPHS: Record<ApplicationStatus, StatusGlyph> = {
  lead: 'empty',
  drafting: 'empty',
  submitted: 'quarter',
  acknowledged: 'quarter',
  in_process: 'half',
  final_round: 'three-quarters',
  offer: 'full',
  rejected: 'cross',
  withdrawn: 'slash',
  ghosted: 'dashed',
  role_closed: 'bar',
};

/**
 * The three task states.
 *
 * `open` is the same empty hexagon a lead is, which is the one sharing across
 * the two ladders and is meant: both mean "nothing has happened to this yet",
 * and no surface shows a task beside an application. `done` is a tick rather
 * than a solid hexagon because the glyph doubles as the toggle on /todo and a
 * tick is what a person expects to click. `dropped` takes the same struck
 * hexagon as a withdrawal, for the same reason: you decided against it.
 */
export const TASK_STATUS_GLYPHS: Record<TaskStatus, StatusGlyph> = {
  open: 'empty',
  done: 'check',
  dropped: 'slash',
};

/**
 * The ten states a plan step can be in, as read by lib/plan/tree.ts.
 *
 * Five of them are a ladder and take the five fills: a proposal nobody has
 * accepted is the empty hexagon, and each step after it fills further round
 * until a finished step is solid. The other five are not positions on that
 * ladder, so they take marks -- an answered question a tick, a step decided
 * against the same struck hexagon a withdrawal takes, a blocked step the
 * barred one, a step waiting on another the dashed one, and a question nobody
 * has answered the question mark.
 *
 * A `Record`, like the two above, so an eleventh health added to PLAN_HEALTHS
 * fails the typecheck here rather than drawing itself as a proposal.
 */
export const PLAN_HEALTH_GLYPHS: Record<PlanHealth, StatusGlyph> = {
  proposed: 'empty',
  not_started: 'quarter',
  ready: 'half',
  in_progress: 'three-quarters',
  done: 'full',
  answered: 'check',
  dropped: 'slash',
  blocked: 'bar',
  waiting: 'dashed',
  unanswered: 'question',
};
