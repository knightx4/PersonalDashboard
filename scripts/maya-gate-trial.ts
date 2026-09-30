/**
 * The report-only trial for plan #1288: ask Jev the gate question about a
 * sample of notes and print which would get an automatic thought from Maya,
 * writing nothing.
 *
 *   npx tsx scripts/maya-gate-trial.ts <notes.json> [results.json]
 *
 * The notes file is a JSON array of { id, path, title, body }, exported from
 * obsidian.notes (the query is in docs/trials/2026-09-30-maya-gate.md). The
 * body may be cut to the first MAYA_GATE_SAMPLE_CHARS characters, since that
 * is all Jev reads. Needs TYPESAFE_API_KEY. The refusals, the question, the
 * state and the line are the ones the hourly job uses (lib/vault/maya/gate.ts),
 * so the trial reads what the job would do. The optional second argument is
 * where to write every answer as JSON, for the write-up.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { askJev, jevApiKey } from '../lib/jev/wire';
import {
  gateRefusal,
  gateVerdict,
  MAYA_GATE_QUESTION,
  MAYA_GATE_THRESHOLD,
  mayaGateState,
  type GateNote,
} from '../lib/vault/maya/gate';

type TrialNote = GateNote & { id: string };

type TrialRow = {
  id: string;
  path: string;
  title: string;
  refused: string | null;
  probability: number | null;
  passes: boolean;
  failure: string | null;
};

const CONCURRENCY = 4;
const LINES = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98];

async function main() {
  const [path, out] = process.argv.slice(2);
  if (!path) throw new Error('Pass the notes file.');
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set.');
  const notes = JSON.parse(readFileSync(path, 'utf8')) as TrialNote[];

  let inputTokens = 0;
  const rows: TrialRow[] = new Array(notes.length);
  let next = 0;
  const worker = async () => {
    while (next < notes.length) {
      const index = next++;
      const note = notes[index];
      const base = { id: note.id, path: note.path, title: note.title };
      const refused = gateRefusal(note);
      if (refused) {
        rows[index] = { ...base, refused: refused.reason, probability: null, passes: false, failure: null };
        continue;
      }
      const result = await askJev({
        state: mayaGateState(note),
        question: MAYA_GATE_QUESTION,
        onSpend: (report) => {
          inputTokens += report.usage.inputTokens;
        },
      });
      const verdict = gateVerdict(result, true);
      rows[index] = {
        ...base,
        refused: null,
        probability: verdict.probability,
        passes: verdict.passes,
        failure: verdict.failure,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, notes.length)) }, worker));

  const asked = rows.filter((row) => row.refused === null);
  const answered = asked.filter((row) => row.probability !== null);
  const sorted = [...answered].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));

  console.log('| Yes | Passes | Note |');
  console.log('| ---: | --- | --- |');
  for (const row of sorted) {
    console.log(`| ${row.probability!.toFixed(3)} | ${row.passes ? 'yes' : ''} | ${row.path} |`);
  }

  console.log('\n| Line | Notes at or above |');
  console.log('| ---: | ---: |');
  for (const line of LINES) {
    console.log(`| ${line} | ${answered.filter((row) => row.probability! >= line).length} |`);
  }

  const refusedCounts = new Map<string, number>();
  for (const row of rows) if (row.refused) refusedCounts.set(row.refused, (refusedCounts.get(row.refused) ?? 0) + 1);
  const failures = asked.filter((row) => row.probability === null);
  console.log(
    `\n${notes.length} notes, ${asked.length} asked, ${answered.length} answered, ` +
      `${answered.filter((row) => row.passes).length} at or above ${MAYA_GATE_THRESHOLD}, ` +
      `${failures.length} failed, ${inputTokens} input tokens.`,
  );
  for (const [reason, count] of refusedCounts) console.log(`not asked (${reason}): ${count}`);
  for (const row of failures) console.log(`failed: ${row.id}: ${row.failure}`);

  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
