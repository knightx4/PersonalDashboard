import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPEC_COUNTERS } from '@/scripts/spec-counts';
import { checkCounters, filesMatching, runSpecCheck, tablesCreated, type SpecCounter } from './counts';

let root: string;
let baselinePath: string;

function put(path: string, text: string) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

function baseline(): Record<string, number> {
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
}

// A fixture repository with one counter over it: files in lib/ that name a model.
const MODEL_FILES: SpecCounter = {
  name: 'model-id-files',
  counts: 'files holding a model id',
  target: 1,
  measure: (r) => filesMatching(r, { dirs: ['lib'], exts: ['.ts'], pattern: /claude-[a-z]+-\d/ }),
};

function run(counters: SpecCounter[] = [MODEL_FILES]) {
  const out: string[] = [];
  const code = runSpecCheck({
    root,
    counters,
    baselinePath,
    log: (l) => out.push(l),
    error: (l) => out.push(l),
  });
  return { code, out: out.join('\n') };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spec-counts-'));
  baselinePath = join(root, 'scripts/spec-baseline.json');
  put('lib/a.ts', `export const M = 'claude-opus-4';`);
  put('lib/b.ts', `export const M = 'claude-haiku-4';`);
  put('lib/c.ts', `export const x = 1;`);
  put('scripts/spec-baseline.json', `${JSON.stringify({ 'model-id-files': 2 })}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check:specs', () => {
  it('passes and writes nothing when every count holds', () => {
    const before = readFileSync(baselinePath, 'utf8');
    expect(run().code).toBe(0);
    expect(readFileSync(baselinePath, 'utf8')).toBe(before);
  });

  it('fails when a count rises, names what it counted, and keeps the baseline', () => {
    put('lib/c.ts', `export const M = 'claude-sonnet-4';`);
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain('model-id-files rose from 2 to 3');
    expect(out).toContain('lib/c.ts');
    expect(baseline()).toEqual({ 'model-id-files': 2 });
  });

  it('records a fall in the baseline, so the old value cannot come back', () => {
    put('lib/b.ts', `export const x = 2;`);
    expect(run().code).toBe(0);
    expect(baseline()).toEqual({ 'model-id-files': 1 });

    put('lib/b.ts', `export const M = 'claude-haiku-4';`);
    expect(run().code).toBe(1);
  });

  it('records a new counter and drops a retired one', () => {
    const tables: SpecCounter = {
      name: 'tables',
      counts: 'tables',
      measure: (r) => tablesCreated(r).map((t) => t.name),
    };
    put('supabase/migrations/0001_a.sql', 'create table things (id int);');
    expect(run([tables]).code).toBe(0);
    expect(baseline()).toEqual({ tables: 1 });
  });

  it('refuses a name a rule could not write', () => {
    expect(() => checkCounters(root, [{ ...MODEL_FILES, name: 'Model Files' }], {})).toThrow(/kebab-case/);
    expect(() => checkCounters(root, [MODEL_FILES, MODEL_FILES], {})).toThrow(/twice/);
  });
});

describe('tablesCreated', () => {
  it('follows search_path, drops and renames, and ignores comments', () => {
    put(
      'supabase/migrations/0001_a.sql',
      `create table orders (id int);
       create table if not exists core.files (id int, body text);
       -- create table ghosts (id int);
       create table raised_comments (id int);
       alter table raised_comments rename to dev_comments;`,
    );
    put(
      'supabase/migrations-x/0001_b.sql',
      `set search_path = job_search, extensions;
       create table sync_jobs (id int);
       create table notes (id int);
       drop table if exists job_search.sync_jobs;`,
    );
    const tables = tablesCreated(root);
    expect(tables.map((t) => t.name)).toEqual([
      'core.files',
      'job_search.notes',
      'public.dev_comments',
      'public.orders',
    ]);
    expect(tables.find((t) => t.name === 'core.files')?.definition).toContain('body text');
  });
});

describe('the repository', () => {
  it('has a baseline entry for every registered counter and no other', () => {
    const recorded = JSON.parse(readFileSync(join(process.cwd(), 'scripts/spec-baseline.json'), 'utf8'));
    expect(Object.keys(recorded).sort()).toEqual(SPEC_COUNTERS.map((c) => c.name).sort());
  });
});
