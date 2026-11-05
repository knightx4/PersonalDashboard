/**
 * A step whose title asks the person to decide is a decision, not a task.
 *
 * Note 35687c09: "Decide how Ask Dash reaches the studio" (#2740) was filed as
 * a setup step assigned to the person, with the choice buried in its detail,
 * so the plan page showed it as a job to do rather than a question with
 * options to click. A title opening with one of these verbs is turned away
 * unless it is written with `--kind decision`.
 */
const DECIDING = /^(?:decide|choose|pick|select)\b/i;

export function decidesSomething(title: string): boolean {
  return DECIDING.test(title.trim());
}

/** Why `add` turns a step away, or null when it may go in. */
export function decisionKindRefusal(input: { kind: string; title: string }): string | null {
  if (input.kind === 'decision') return null;
  if (!decidesSomething(input.title)) return null;
  return (
    `"${input.title.trim()}" asks for a choice, so it is a decision, not a ${input.kind} step. ` +
    'Write it as the question with --kind decision, and letter two to four options in the detail ' +
    '("A — …", one per line) so the plan offers each as a button.'
  );
}
