/**
 * Changes Dash proposes to a spec, and what the weekly audit found that led to
 * them (plan #1505, docs/SPEC-LAYER-SPEC.md parts 2 and 3). Stored in
 * `spec_changes` and `spec_findings` (supabase/migrations/0155).
 *
 * A change is the diff to one spec's markdown, with a title and a why. The
 * person approves or declines it on /dev/specs; an approved change is
 * committed to docs/ and marked applied. The database refuses a diff over
 * MAX_CHANGED_LINES, counted by `spec_diff_changed_lines`, which
 * `countChangedLines` here mirrors so a draft can be checked before it is
 * written.
 *
 * Not `server-only`: the audit writes through a script outside Next.
 */

export type SpecChangeStatus = 'proposed' | 'approved' | 'declined' | 'applied';
export type SpecChangeMadeBy = 'me' | 'claude';

export type SpecFindingKind = 'holds' | 'drifted' | 'missing' | 'undescribed' | 'missing_rule';
export type SpecFindingProposal = 'change_code' | 'change_spec' | 'none';

/** The most lines a change may add and remove between them. */
export const MAX_CHANGED_LINES = 60;

/**
 * The lines a unified diff adds or removes. File headers and anything before
 * the first `@@` are not counted; a `--- ` line followed by `+++ ` starts a
 * new file. The same rule as `spec_diff_changed_lines` in the migration.
 */
export function countChangedLines(diff: string): number {
  const lines = diff.replace(/\r/g, '').split('\n');
  let inHunk = false;
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff ')) {
      inHunk = false;
    } else if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      changed++;
    }
  }
  return changed;
}

/** Whether the database will take this diff: at least one change, at most the cap. */
export function diffFits(diff: string): boolean {
  const n = countChangedLines(diff);
  return n >= 1 && n <= MAX_CHANGED_LINES;
}
