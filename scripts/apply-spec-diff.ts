/**
 * Write an approved spec change into its spec (plan #1509).
 *
 *   npx tsx scripts/apply-spec-diff.ts docs/SPEC-LAYER-SPEC.md change.diff
 *
 * Places the diff against the file as it stands (`applyDiff`, which re-anchors
 * each hunk by its lines rather than trusting its line numbers), writes the
 * file, and prints the placed diff. A file that does not exist yet is a spec
 * the change creates, and every hunk has to be an addition. When the lines
 * the change touches are no longer in the spec, it says which and writes
 * nothing, exiting 1.
 *
 * Read by the run the approve button starts; .claude/skills/plan/reference/
 * shaping.md, "From an approved spec change", is the procedure around it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applyDiff } from '../lib/specs/changes';

const [file, diffFile] = process.argv.slice(2);
if (!file || !diffFile) {
  console.error('usage: npx tsx scripts/apply-spec-diff.ts <docs/SPEC.md> <diff file>');
  process.exit(2);
}

const markdown = existsSync(file) ? readFileSync(file, 'utf8') : null;
const result = applyDiff(readFileSync(diffFile, 'utf8'), markdown);
if (!result.ok) {
  console.error(`Not applied: ${result.why}`);
  process.exit(1);
}

writeFileSync(file, result.markdown);
process.stdout.write(result.diff);
