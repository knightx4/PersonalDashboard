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

/** The line the claim sweep writes when it takes a claim back. */
const CLAIM_EXPIRED_LINE = /^Claim expired \d{4}-\d{2}-\d{2}\b/;

/**
 * Whether a step's comment ends on its Built line once any claim-expired
 * lines after it are set aside.
 *
 * Until #2815.1 the sweep took built steps back too: it put them to not
 * started and wrote a "Claim expired" line beneath the Built one. Their
 * features then merged, but `land` read only in-progress steps ending on a
 * Built line and passed them over, so on 4 November 2026 23 steps whose
 * commits were on main still showed as not started. `land` reads them with
 * this test, and `doneRefusal` still checks each commit is on main.
 */
export function builtBeneathExpiries(comment: string | null | undefined): boolean {
  const paragraphs = String(comment ?? '')
    .split(/\n\n/)
    .map((paragraph) => paragraph.trim());
  while (paragraphs.length > 0 && CLAIM_EXPIRED_LINE.test(paragraphs[paragraphs.length - 1])) {
    paragraphs.pop();
  }
  return BUILT_LINE.test(paragraphs[paragraphs.length - 1] ?? '');
}
