/**
 * A step that is built and waiting for its feature to land.
 *
 * `plan.ts built` leaves the step `in_progress` with its commit on a branch and
 * a dated "Built" line as the last paragraph of its comment; `land` closes it
 * once the commit is on main. The sweep, the send guard and the overnight tick
 * all need to tell that step from one a live session is holding, so the test is
 * here for them and for the CLI alike.
 */

/** The dated line `built` writes, which `land` looks for as the step's last. */
export const BUILT_LINE = /^Built \d{4}-\d{2}-\d{2}\b/;

/** Whether the last paragraph of a step's comment is its Built line. */
export function endsWithBuiltLine(comment: string | null | undefined): boolean {
  const paragraphs = String(comment ?? '').split(/\n\n/);
  return BUILT_LINE.test(paragraphs[paragraphs.length - 1]?.trim() ?? '');
}
