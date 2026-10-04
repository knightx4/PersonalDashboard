/**
 * Re-record the capture sorter's fixtures against Haiku (plan #1580).
 *
 *   npx tsx --conditions=react-server scripts/record-capture-sort.ts
 *
 * Sends every sentence in lib/capture/fixtures/sort.json through the real
 * sort call with all four places offered, and writes each reply back over
 * the case's `reply`, with `recorded` set to the model and the day. The
 * expectations are left alone, so `npx vitest run lib/capture/sort.test.ts`
 * afterwards says whether Haiku still sorts every case the way it should.
 *
 * Needs ANTHROPIC_API_KEY, from the environment or from .env.local and .env.
 * About a tenth of a cent a sentence.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { config as loadEnvFile } from 'dotenv';
import { CAPTURE_PLACES, type CaptureSortGoal, type CaptureSortRole } from '../lib/capture/sort';
import { CAPTURE_SORT_MODEL, requestCaptureSort } from '../lib/capture/sort-model';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

const FILE = 'lib/capture/fixtures/sort.json';

type Fixtures = {
  goals: CaptureSortGoal[];
  roles: CaptureSortRole[];
  cases: Array<{ name: string; sentence: string; recorded: string; reply: unknown }>;
};

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client = new Anthropic({ apiKey });
  const fixtures = JSON.parse(readFileSync(FILE, 'utf8')) as Fixtures;
  const context = { places: CAPTURE_PLACES, goals: fixtures.goals, roles: fixtures.roles };
  const day = new Date().toISOString().slice(0, 10);

  for (const fixture of fixtures.cases) {
    const reply = await requestCaptureSort(fixture.sentence, context, { client });
    if (reply === null) {
      console.log(`${fixture.name}: no reply, kept the old one`);
      continue;
    }
    fixture.reply = reply;
    fixture.recorded = `${CAPTURE_SORT_MODEL} on ${day}`;
    console.log(`${fixture.name}: ${JSON.stringify(reply)}`);
  }
  writeFileSync(FILE, `${JSON.stringify(fixtures, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
