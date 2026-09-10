/**
 * One shape per state, so a state is readable with the colour taken away.
 *
 * Law 4 tells whoever draws the next surface to use "ink and a shape" and
 * never says anywhere what the shapes are. These are them: a glyph for each of
 * the eleven application statuses and each of the three task states. The names
 * are shapes rather than statuses, because components/ui/status-glyph.tsx
 * draws them and knows nothing about pipelines or todo lists.
 *
 * The vocabulary is Linear's — an outline at the start of a ladder, the shape
 * filled further as it advances, solid at the top, struck when it ended badly
 * — drawn as hexagons instead of circles. The 2026 redraw took every arc and
 * circle out of the mark set on purpose (components/ui/module-mark.tsx), so a
 * set of rings would have been the only round shapes in the app.
 *
 * This lives at the root of lib/ beside modules.ts and density.ts because it
 * crosses two workspaces. Neither lib/jobs nor lib/todo owns it.
 */
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { TaskStatus } from '@/lib/todo/tasks/model';

/**
 * The whole vocabulary. Five fill levels for a rung on a ladder, and five
 * marks for a state that is not on one.
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
