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

/** The `(plan #…)` references at the end of a commit subject, without the `#`. */
export function subjectSteps(subject: string): string[] {
  const out: string[] = [];
  for (const match of subject.matchAll(/\(plan #([0-9]+(?:\.[0-9]+)*)\)/g)) out.push(match[1]);
  return out;
}

/** Whether a commit subject names this step, by number or outline, or a step beneath it. */
export function subjectNamesStep(subject: string, number: number, outline: string): boolean {
  return subjectSteps(subject).some(
    (ref) => ref === String(number) || ref === outline || ref.startsWith(`${outline}.`),
  );
}

/** One commit on the branch, newest first, as `git log --format=%h%x09%s` gives it. */
export type BranchCommit = { sha: string; subject: string };

/**
 * The commit `built` records for a step, or a refusal.
 *
 * Until 5 November 2026 `built` recorded HEAD. A session that built
 * #2879.1.1, .1.2 and .1.4 and then .1.3 marked all four built at the end, so
 * each carried .1.3's commit, which drew 19 screen files. `land` then asked
 * the critic for 21 chat surfaces under steps that changed none, and six runs
 * went into re-recording rounds before anyone looked at the commit.
 *
 * So without `--commit`, the newest commit on the branch whose subject names
 * the step (or a step beneath it) is recorded, and HEAD only when no subject
 * names it. With `--commit`, a commit whose subject names other steps and not
 * this one is refused; a commit with no `(plan #…)` at all, such as a merge,
 * is taken as given.
 */
export function chooseBuiltCommit(input: {
  number: number;
  outline: string;
  given: string | null;
  givenSubject: string | null;
  head: string | null;
  branch: readonly BranchCommit[];
}): { commit: string; why: string } | { refusal: string } {
  const { number, outline, given, givenSubject, head, branch } = input;
  if (given) {
    const named = subjectSteps(givenSubject ?? '');
    if (named.length > 0 && !subjectNamesStep(givenSubject ?? '', number, outline)) {
      const own = branch.find((c) => subjectNamesStep(c.subject, number, outline));
      return {
        refusal:
          `${given} is "${givenSubject}", which names ${named.map((n) => `#${n}`).join(', ')} and not #${outline}. ` +
          (own
            ? `This step's own commit looks like ${own.sha} ("${own.subject}"): pass --commit ${own.sha}.`
            : `Pass the commit that built #${outline}, or a merge that holds it.`),
      };
    }
    return { commit: given, why: 'as given' };
  }
  const own = branch.find((c) => subjectNamesStep(c.subject, number, outline));
  if (own) return { commit: own.sha, why: `the newest commit naming #${outline}` };
  if (!head) return { refusal: 'No commit to record: pass --commit <sha>.' };
  const headSubject = branch[0]?.sha === head ? branch[0].subject : '';
  if (subjectSteps(headSubject).length > 0) {
    return {
      refusal:
        `No commit on this branch names #${outline}, and HEAD (${head}, "${headSubject}") names another step. ` +
        `Commit this step's work with "(plan #${outline})" at the end of its subject, or pass --commit <sha>.`,
    };
  }
  return { commit: head, why: 'HEAD: no commit subject names this step' };
}
