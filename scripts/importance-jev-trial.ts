/**
 * The report-only trial for moving story importance onto Jev (plan #1170):
 * ask Jev the importance question about stories Haiku has already rated and
 * compare, writing nothing.
 *
 *   npx tsx scripts/importance-jev-trial.ts <stories.json> [results.json]
 *
 * The stories file is a JSON array of { i, p, t, h, s, r }: the issue id's
 * first eight characters, the story's position in its newsletter, its topic,
 * headline and summary, and Haiku's stored rating. It is exported from
 * news.issues (the query is in docs/trials/2026-10-01-jev-news-importance.md).
 * Needs TYPESAFE_API_KEY. The question, the state and the level-to-rating
 * mapping are the ones the catch-up uses (lib/news/issues/importance-jev.ts),
 * and the floor is decideWithJev's, so the trial reads what the job would do.
 * The optional second argument is where to write every answer as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JEV_CONFIDENCE_FLOOR } from '../lib/jev/decide';
import { askJev, jevApiKey } from '../lib/jev/wire';
import {
  IMPORTANCE_QUESTION,
  ratingFromLevel,
  storyState,
} from '../lib/news/issues/importance-jev';

type TrialStory = { i: string; p: number; t: string | null; h: string; s: string; r: number };

type TrialRow = TrialStory & {
  jev: number | null;
  score: number | null;
  confidence: number | null;
  probabilities: number[] | null;
  failure: string | null;
};

const CONCURRENCY = 6;

async function main() {
  const [path, out] = process.argv.slice(2);
  if (!path) throw new Error('Pass the stories file.');
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set.');
  const stories = JSON.parse(readFileSync(path, 'utf8')) as TrialStory[];

  let inputTokens = 0;
  const rows: TrialRow[] = new Array(stories.length);
  let next = 0;
  const worker = async () => {
    while (next < stories.length) {
      const index = next++;
      const story = stories[index];
      const result = await askJev({
        state: storyState({ index: story.p, topic: story.t, headline: story.h, summary: story.s }),
        question: IMPORTANCE_QUESTION,
        onSpend: (report) => {
          inputTokens += report.usage.inputTokens;
        },
      });
      rows[index] = result.ok
        ? {
            ...story,
            jev: ratingFromLevel(result.answer.level),
            score: result.answer.score,
            confidence: result.answer.confidence,
            probabilities: result.answer.probabilities,
            failure: null,
          }
        : {
            ...story,
            jev: null,
            score: null,
            confidence: null,
            probabilities: null,
            failure: `${result.reason}: ${result.detail}`,
          };
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, stories.length)) }, worker),
  );

  const answered = rows.filter((row) => row.jev !== null);
  const sure = answered.filter((row) => row.confidence! >= JEV_CONFIDENCE_FLOOR);
  const table = (set: TrialRow[], title: string) => {
    console.log(`\n${title}: Haiku down, Jev across`);
    console.log('| Haiku | 1 | 2 | 3 | 4 | 5 |');
    console.log('| ---: | ---: | ---: | ---: | ---: | ---: |');
    for (let h = 1; h <= 5; h++) {
      const cells = [1, 2, 3, 4, 5].map(
        (j) => set.filter((row) => row.r === h && row.jev === j).length,
      );
      console.log(`| ${h} | ${cells.join(' | ')} |`);
    }
    const same = set.filter((row) => row.jev === row.r).length;
    const near = set.filter((row) => Math.abs(row.jev! - row.r) <= 1).length;
    console.log(
      `${set.length} stories, ${same} the same, ${near} within one, ${set.length - near} two or more apart.`,
    );
  };
  table(answered, 'Every answer');
  table(sure, `At or above the ${JEV_CONFIDENCE_FLOOR} floor`);

  console.log('\n| Confidence at or above | Stories |');
  console.log('| ---: | ---: |');
  for (const line of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    console.log(`| ${line} | ${answered.filter((row) => row.confidence! >= line).length} |`);
  }

  const lead = (set: TrialRow[]) => {
    const mean = (xs: number[]) =>
      xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-';
    console.log(`\nMean rating, lead story vs the rest:`);
    console.log(
      `Haiku ${mean(set.filter((r) => r.p === 0).map((r) => r.r))} vs ${mean(set.filter((r) => r.p > 0).map((r) => r.r))}`,
    );
    console.log(
      `Jev   ${mean(set.filter((r) => r.p === 0).map((r) => r.jev!))} vs ${mean(set.filter((r) => r.p > 0).map((r) => r.jev!))}`,
    );
  };
  lead(answered);

  const failures = rows.filter((row) => row.jev === null);
  console.log(
    `\n${stories.length} stories, ${answered.length} answered, ${failures.length} failed, ${inputTokens} input tokens.`,
  );
  for (const row of failures.slice(0, 10)) console.log(`failed: ${row.i}/${row.p}: ${row.failure}`);

  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
