import { PLAIN_ENGLISH_RULE, QUESTION_RULE } from '@/lib/plan/brief';

/**
 * What the plan routine is told when you approve a spec change (plan #1509,
 * docs/SPEC-LAYER-SPEC.md Part 3).
 *
 * Approving is the last press the change needs: one run writes the diff into
 * docs/, puts it on main through the gate, marks the change applied, and
 * shapes it into work that goes in approved, since approving the change was
 * the decision. #1508 kept one stop for a change that replaces how something
 * works, and the procedure for that is in the shaping section the brief
 * points at, not here.
 *
 * Pure, so what the run is told can be tested without a routine.
 */
export function specChangeRunText(input: {
  id: string;
  title: string;
  why: string;
  /** The spec's slug in lib/specs/registry.ts. */
  spec: string;
  /** Its file under docs/, or null for a spec the change creates. */
  file: string | null;
  /** The diff, already placed against the spec as the app last read it. */
  diff: string;
}): string {
  const target = input.file
    ? `docs/${input.file} (the "${input.spec}" spec)`
    : `a new spec, "${input.spec}", which has no file or registry entry yet`;
  return (
    `Write approved spec change ${input.id} into ${target}, put it on main, and shape it into ` +
    'work, following "From an approved spec change" in .claude/skills/plan/reference/shaping.md. ' +
    'The person approved it on /dev/specs a moment ago. That approval is the decision for the ' +
    'work it becomes, so what you shape goes in approved, apart from the exceptions that section ' +
    'names.\n\n' +
    'Re-read the change from spec_changes first and stop if it is no longer approved. Commit the ' +
    'diff as it is: an approved change cannot be reworded, and the person approved these lines. ' +
    'Report the commit, the change marked applied, and every row you wrote by number and title.\n\n' +
    `${PLAIN_ENGLISH_RULE}\n\n${QUESTION_RULE}\n\n` +
    `## The change\n\n${input.title.trim()}\n\n` +
    `## Why\n\n${input.why.trim()}\n\n` +
    `## The diff\n\n\`\`\`diff\n${input.diff.trimEnd()}\n\`\`\``
  );
}
