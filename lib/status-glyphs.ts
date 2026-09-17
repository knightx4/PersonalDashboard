/**
 * One shape per state, so a state is readable with the colour taken away.
 *
 * Law 4 tells whoever draws the next surface to use "ink and a shape" and
 * never says anywhere what the shapes are. These are them: a glyph for each of
 * the eleven application statuses, each of the three task states, each of the
 * ten states a plan step can be in, and each state of the four other dev
 * queues. The names are shapes rather than statuses, because
 * components/ui/status-glyph.tsx draws them and knows nothing about pipelines,
 * todo lists or plans.
 *
 * A state two of these maps share takes one shape in both. The words are shared
 * the same way, in lib/dev/words.ts, and a state that read alike but drew
 * differently would undo half of that.
 *
 * The vocabulary is Linear's — an outline at the start of a ladder, the shape
 * filled further as it advances, solid at the top, struck when it ended badly
 * — drawn as hexagons instead of circles. The 2026 redraw took every arc and
 * circle out of the mark set on purpose (components/ui/module-mark.tsx), so a
 * set of rings would have been the only round shapes in the app.
 *
 * This lives at the root of lib/ beside modules.ts and density.ts because it
 * crosses four workspaces. None of lib/jobs, lib/todo, lib/plan or lib/dev
 * owns it.
 */
import type {
  FeedbackHealth,
  FindingHealth,
  IdeaHealth,
  RaisedHealth,
} from '@/lib/dev/health';
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
 * The states a plan step can be in, as read by lib/plan/tree.ts.
 *
 * Five of them are a ladder and take the five fills: a proposal nobody has
 * accepted is the empty hexagon, and each step after it fills further round
 * until a finished step is solid. The others are not positions on that ladder,
 * so they take marks -- an answered question a tick, a step decided against
 * the same struck hexagon a withdrawal takes, a blocked step the barred one, a
 * step waiting on another the dashed one, and a question nobody has answered
 * the question mark.
 *
 * `working` and `quiet` share the three-quarter fill with `in_progress`
 * because they are the same rung: all three are a step somebody has claimed,
 * and what separates them is whether the session is still pushing, which the
 * tone and the word say. `abandoned` is the one that leaves the ladder -- a
 * run that stopped without closing its step -- so it takes the cross.
 *
 * A `Record`, like the two above, so a health added to PLAN_HEALTHS fails the
 * typecheck here rather than drawing itself as a proposal.
 */
export const PLAN_HEALTH_GLYPHS: Record<PlanHealth, StatusGlyph> = {
  proposed: 'empty',
  not_started: 'quarter',
  ready: 'half',
  in_progress: 'three-quarters',
  working: 'three-quarters',
  quiet: 'three-quarters',
  abandoned: 'cross',
  done: 'full',
  answered: 'check',
  dropped: 'slash',
  blocked: 'bar',
  waiting: 'dashed',
  unanswered: 'question',
};

/**
 * The bugs and requests queue, keyed by what a note means rather than by its
 * column: `blocked` is two states, and lib/dev/health.ts is what tells them
 * apart.
 *
 * Shapes the plan already uses for the same states, because lib/dev/words.ts
 * gives them the same words: a note nobody has picked up is half filled the way
 * a ready step is, a note a run has claimed is three quarters filled, and a note
 * stopped on you is barred. `answered` takes the tick a settled plan question
 * takes -- you replied, and it is a session's again.
 *
 * `planned` is the one this queue owns, and it is dashed rather than a rung: the
 * note has been written into the build plan and waits on a step there, which is
 * exactly what the dashed hexagon says about a plan step waiting on another.
 */
export const FEEDBACK_HEALTH_GLYPHS: Record<FeedbackHealth, StatusGlyph> = {
  waiting: 'bar',
  answered: 'check',
  ready: 'half',
  planned: 'dashed',
  working: 'three-quarters',
  done: 'full',
  dropped: 'slash',
};

/**
 * What Claude has raised.
 *
 * An open raise is a question waiting on you, so it takes the question mark
 * rather than the bar -- the same distinction the plan draws between a step
 * stopped on something and a question nobody has answered. `unfinished` is a
 * raise you answered with nothing recorded as coming of it, which is work a
 * session owes, so it takes the half-filled hexagon a ready step takes.
 *
 * `answered` takes the tick a settled plan question takes: you replied, and it
 * is a session's again. `closed` is the solid hexagon every other queue's
 * finished row draws, because that is what it is -- the raise is done with,
 * and answering it was a rung on the way there rather than the top.
 */
export const RAISED_HEALTH_GLYPHS: Record<RaisedHealth, StatusGlyph> = {
  waiting: 'question',
  unfinished: 'half',
  answered: 'check',
  closed: 'full',
  dropped: 'slash',
};

/**
 * What a UI pass found.
 *
 * A finding is filed as a candidate and you confirm or dismiss it, so an open
 * one is a question the same way a raise is. A confirmed one is the half-filled
 * hexagon a ready step takes: agreed, and nobody on it yet.
 */
export const FINDING_HEALTH_GLYPHS: Record<FindingHealth, StatusGlyph> = {
  waiting: 'question',
  ready: 'half',
  dropped: 'slash',
};

/**
 * An idea on /dev/ideas, read through the plan row it became.
 *
 * `open` is the empty hexagon a lead and an untouched task are: nothing has
 * happened to it. A shaped idea splits three ways, because what it became is
 * what matters -- a proposal nobody has approved is a question waiting on you,
 * an approved feature is dashed like anything waiting on work elsewhere, and a
 * finished one is solid. `dropped` shares the struck hexagon with everything
 * else nobody is doing; the word beside it keeps the difference, because
 * putting an idea aside is reversible and dropping a step is a decision.
 */
export const IDEA_HEALTH_GLYPHS: Record<IdeaHealth, StatusGlyph> = {
  open: 'empty',
  waiting: 'question',
  shaped: 'dashed',
  done: 'full',
  dropped: 'slash',
};
