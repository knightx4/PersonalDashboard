import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEARN_OPERATIONS } from '@/lib/learn/spend';
import { SPEND_OPERATIONS } from './operations';

/**
 * Every model call reports what it cost.
 *
 * The spend page and the cost hints are only as good as the ledger, and the
 * ledger only has the calls somebody remembered to wire in. Fourteen files had
 * been missed by the time this test was written (plan #914). So the rule is
 * checked rather than remembered: any file under lib, app or inngest that calls
 * `messages.create` or `messages.stream` must also mention `onSpend` (it hands
 * the cost to its caller) or one of the `record…Spend` writers (`recordSpend`,
 * `recordSessionSpend`, `recordLearnSpend`), when it writes the row itself.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SCANNED = ['lib', 'app', 'inngest'];
const MODEL_CALL = /\.messages\.(create|stream)\s*\(/;
const REPORTS_SPEND = /\bonSpend\b|\brecord\w*Spend\w*\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The files that call a model and never report what it cost. */
function unreportedModelCalls(files: { path: string; source: string }[]): string[] {
  return files
    .filter((file) => MODEL_CALL.test(file.source) && !REPORTS_SPEND.test(file.source))
    .map((file) => file.path);
}

describe('model spend coverage', () => {
  it('finds a model call with no spend reporting', () => {
    const bare = "const r = await client.messages.create({ model: 'claude-haiku-4-5' });";
    const reported = `${bare}\noptions.onSpend?.({ model, usage });`;
    const recorded = `${bare}\nawait recordSpendReports(core, userId, target, spend);`;

    expect(
      unreportedModelCalls([
        { path: 'bare.ts', source: bare },
        { path: 'reported.ts', source: reported },
        { path: 'recorded.ts', source: recorded },
        { path: 'no-call.ts', source: 'export const x = 1;' },
      ]),
    ).toEqual(['bare.ts']);
  });

  it('has no model call in lib, app or inngest without it', () => {
    const files = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
      path: relative(ROOT, path),
      source: readFileSync(path, 'utf8'),
    }));

    // The scan has to be finding the calls for its silence to mean anything.
    expect(files.filter((file) => MODEL_CALL.test(file.source)).length).toBeGreaterThan(30);
    expect(unreportedModelCalls(files)).toEqual([]);
  });
});

describe('operation names', () => {
  it('are kebab case and used once across every module', () => {
    const names = [...LEARN_OPERATIONS, ...Object.values(SPEND_OPERATIONS).flat()];
    for (const name of names) expect(name).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    expect(new Set(names).size).toBe(names.length);
  });
});
