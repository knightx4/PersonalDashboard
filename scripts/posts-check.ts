/**
 * Check X drafts before the posts run inserts them (plan #1417).
 *
 *   npx tsx scripts/posts-check.ts <file.json>
 *
 * The file holds:
 *
 *   {
 *     "avoid": ["terms that must not appear", "..."],
 *     "sources": [{ "label": "#1234", "module": "dev", "text": "title and detail" }],
 *     "drafts": [{ "angle": "the one idea", "posts": ["the post", "..."] }]
 *   }
 *
 * `avoid` and `sources` are optional. Prints each source that may not be cited
 * and each draft as PASS or FAIL with X's count per post and the reasons, and
 * exits 1 when anything fails. The rules are lib/dev/post-check.ts; a failing
 * draft is dropped, not edited around (docs/X-POSTS.md).
 */
import { readFileSync } from 'node:fs';
import {
  checkDraft,
  sourceProblems,
  type DraftToCheck,
  type SourceToCheck,
} from '../lib/dev/post-check';

type Input = { avoid?: string[]; sources?: SourceToCheck[]; drafts?: DraftToCheck[] };

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx scripts/posts-check.ts <file.json>');
  process.exit(2);
}

const input = JSON.parse(readFileSync(path, 'utf8')) as Input;
const avoid = input.avoid ?? [];
let failed = false;

for (const source of input.sources ?? []) {
  const problems = sourceProblems(source, avoid);
  if (problems.length === 0) continue;
  failed = true;
  console.log(`SOURCE ${source.label}: may not be cited`);
  for (const problem of problems) console.log(`  - ${problem}`);
}

(input.drafts ?? []).forEach((draft, i) => {
  const result = checkDraft(draft, avoid);
  if (!result.ok) failed = true;
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'} draft ${i + 1} (${result.lengths.join(', ')}): ${draft.angle}`,
  );
  for (const problem of result.problems) console.log(`  - ${problem}`);
  for (const warning of result.warnings) console.log(`  ~ ${warning}`);
});

process.exit(failed ? 1 : 0);
