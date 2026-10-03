/**
 * Turn notes asking for the same thing on three pages into one proposed rule
 * (plan #1526, docs/SPEC-LAYER-SPEC.md part 5).
 *
 *   npx tsx scripts/note-rule.ts <draft.json>
 *
 * The draft is a JSON file the notes routine writes:
 *
 *   {
 *     "user": "<user id>",
 *     "spec": "<registry slug, or a workspace id with no spec>",
 *     "section": "Rules",
 *     "finding": "<what the notes keep asking for>",
 *     "title": "<what will be true afterwards>",
 *     "why": "<two to five sentences citing the notes>",
 *     "diffFile": "<path to the unified diff>",
 *     "notes": [ <rows of id, kind, status, page_path, created_at, spec_change_id> ]
 *   }
 *
 * It checks the notes span three pages within 30 days and the diff fits, then
 * prints one statement for the Supabase connector: it drafts the change unless
 * five are waiting, files the missing_rule finding, and links the notes. When
 * the notes are not a rule it says why and exits 1, and each note is fixed on
 * its page as usual. The rules are lib/specs/note-rules.ts; the procedure is
 * .claude/skills/notes, "Requests that point at a missing rule".
 */
import { readFileSync } from 'node:fs';
import { currentSession } from '../lib/plan/origin';
import {
  checkRuleRequest,
  noteRuleProblem,
  noteRuleSql,
  type RuleNote,
} from '../lib/specs/note-rules';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/note-rule.ts <draft.json>');
  process.exit(2);
}

type Draft = {
  user: string;
  spec: string;
  section?: string | null;
  finding: string;
  title: string;
  why: string;
  diffFile: string;
  notes: RuleNote[];
};
const draft = JSON.parse(readFileSync(file, 'utf8')) as Draft;

const check = checkRuleRequest(draft.notes ?? [], new Date());
for (const left of check.leftOut) console.error(`Not counted: ${left.id.slice(0, 8)}, ${left.why}.`);
if (!check.ok) {
  console.error(`Not a rule. ${check.why}`);
  process.exit(1);
}

const input = {
  userId: draft.user,
  spec: draft.spec,
  section: draft.section ?? null,
  finding: draft.finding,
  sessionId: currentSession(process.env) ?? null,
  notes: check.notes,
  change: { title: draft.title, why: draft.why, diff: readFileSync(draft.diffFile, 'utf8') },
};
const problem = noteRuleProblem(input);
if (problem) {
  console.error(problem);
  process.exit(1);
}

console.error(`A rule: ${check.notes.length} notes on ${check.pages.join(', ')}.`);
console.log(noteRuleSql(input));
