/**
 * Merge questions stored twice under different fingerprints (plan #2195.2).
 *
 *   npx tsx scripts/merge-questions.ts --dry-run
 *   npx tsx scripts/merge-questions.ts
 *   npx tsx scripts/merge-questions.ts --from-file rows.json > merge.sql
 *
 * Recomputes the fingerprint of every row in job_search.questions with the
 * current questionFingerprint, groups rows per user that now share one, keeps
 * the oldest in each group and moves everything onto it: the answers on
 * applications, the generated_from links, times_seen and a missing canonical
 * answer. The extra rows are deleted and every surviving row gets its new
 * fingerprint. Each group is printed before anything changes, and the changes
 * run in one transaction. The planning is in lib/jobs/merge-questions.ts.
 *
 * Needs DATABASE_URL (service role), from the environment or .env.local.
 * `--dry-run` prints the groups and stops.
 *
 * `--from-file` is for a session with no DATABASE_URL: it reads
 * `{ "questions": [...], "answers": [...] }` (the columns named in
 * lib/jobs/merge-questions.ts, from job_search.questions and
 * job_search.application_answers) and prints the plan as ordered SQL in one
 * begin/commit block, to apply through the Supabase connector. The plan goes
 * to stderr and the SQL to stdout. Run it on rows fetched when you apply it.
 */
import { readFileSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import postgres from 'postgres';
import {
  describePlan,
  planQuestionMerges,
  planStatements,
  type AnswerRow,
  type QuestionRow,
} from '../lib/jobs/merge-questions';

loadEnvFile({ path: '.env.local', quiet: true });
loadEnvFile({ quiet: true });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileIdx = args.indexOf('--from-file');

async function main() {
  if (fileIdx !== -1) {
    const file = args[fileIdx + 1];
    if (!file) throw new Error('--from-file needs a path');
    const data = JSON.parse(readFileSync(file, 'utf8')) as { questions: QuestionRow[]; answers?: AnswerRow[] };
    const plan = planQuestionMerges(data.questions, data.answers ?? []);
    console.error(describePlan(plan));
    console.log(['begin;', ...planStatements(plan).map((s) => `${s};`), 'commit;'].join('\n'));
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Use --from-file to print SQL instead.');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const questions = await sql<QuestionRow[]>`
      select id, user_id, text, fingerprint, canonical_answer,
             canonical_answer_updated_at::text, times_seen, created_at::text
      from job_search.questions`;
    const answers = await sql<AnswerRow[]>`
      select id, application_id, question_id, answer,
             generated_from_question_id, created_at::text
      from job_search.application_answers`;
    const plan = planQuestionMerges(questions, answers);
    console.log(describePlan(plan));
    if (dryRun) {
      console.log('dry run: nothing changed');
      return;
    }
    await sql.begin(async (tx) => {
      for (const stmt of planStatements(plan)) await tx.unsafe(stmt);
    });
    console.log('merged');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
