import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingPreparationSteps, PREPARATION_STEP_LABELS, PREPARATION_STEPS } from './steps';

const MIGRATION = join(process.cwd(), 'supabase/migrations-learn/0173_subject_preparation_first_lesson.sql');

function quoted(block: string): string[] {
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('the preparation steps', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('are the eight keys the page draws, in order', () => {
    expect(PREPARATION_STEPS).toEqual([
      'classify',
      'pull_documents',
      'match_weeks',
      'compile_territory',
      'draft_topics',
      'write_units',
      'finish',
      'first_lesson',
    ]);
    expect(Object.keys(PREPARATION_STEP_LABELS).sort()).toEqual([...PREPARATION_STEPS].sort());
  });

  it('match the keys the trigger opens a run with, in the same order', () => {
    const block = sql.match(/from unnest\(array\[([\s\S]*?)\]::text\[\]\)/);
    expect(block).not.toBeNull();
    expect(quoted(block![1])).toEqual([...PREPARATION_STEPS]);
  });

  it('match the keys the table allows', () => {
    const block = sql.match(/subject_preparation_steps_key_ck check \(key in \(([\s\S]*?)\)\)/);
    expect(block).not.toBeNull();
    expect(quoted(block![1])).toEqual([...PREPARATION_STEPS]);
  });
});

describe('missingPreparationSteps', () => {
  it('names the steps a run opened before first_lesson lacks, at their ordinals (note b4a7a759)', () => {
    const seven = PREPARATION_STEPS.slice(0, 7).map((key) => ({ key }));
    expect(missingPreparationSteps(seven)).toEqual([{ key: 'first_lesson', ordinal: 8 }]);
  });

  it('names none for a run with every row', () => {
    expect(missingPreparationSteps(PREPARATION_STEPS.map((key) => ({ key })))).toEqual([]);
  });
});
