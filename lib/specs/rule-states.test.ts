import { describe, expect, it } from 'vitest';
import { parseRules } from './rules';
import { ruleStates } from './rule-states';

const counters = new Map<string, { target?: number }>([
  ['thread-tables', { target: 1 }],
  ['link-tables', { target: 0 }],
  ['learn-tabs', {}],
]);

function states(body: string, baseline: Record<string, number>) {
  return ruleStates(parseRules(`## Rules\n\n${body}`), { baseline, counters });
}

describe('ruleStates', () => {
  it('shows a count against its target, and how far it has come down', () => {
    const [s] = states('**R1.** One thread table.\nChecked by: count `thread-tables`, baseline 6, target 1.', {
      'thread-tables': 4,
    });
    expect(s.kind).toBe('counting');
    expect(s.summary).toBe('4 now, down from 6, target 1.');
    expect(s.count).toEqual({ counter: 'thread-tables', value: 4, target: 1, written: 6 });
  });

  it('holds a count at its target, and a count with no target where it is', () => {
    const [atTarget, held] = states(
      [
        '**R1.** None.\nChecked by: count `link-tables`, baseline 4, target 0.',
        '**R2.** Four tabs.\nChecked by: count `learn-tabs`, baseline 4.',
      ].join('\n\n'),
      { 'link-tables': 0, 'learn-tabs': 4 },
    );
    expect([atTarget.kind, atTarget.summary]).toEqual(['holding', 'At its target of 0.']);
    expect([held.kind, held.summary]).toEqual(['holding', 'Held at 4.']);
  });

  it('fails a count the baseline has no entry for', () => {
    const [s] = states('**R1.** One.\nChecked by: count `thread-tables`, baseline 6, target 1.', {});
    expect(s.kind).toBe('failing');
  });

  it('reads a test as held by the gate, a pending check by its step, and the audit', () => {
    const [test, pending, audit] = states(
      [
        '**R1.** Recorded.\nChecked by: test `tests/a.test.ts`.',
        '**R2.** Undone.\nChecked by: test `tests/b.test.ts`, pending #1459.',
        '**R3.** Plain.\nChecked by: audit.',
      ].join('\n\n'),
      {},
    );
    expect([test.kind, test.summary]).toEqual(['holding', 'Held by `tests/a.test.ts`, which the gate runs.']);
    expect([pending.kind, pending.pendingStep]).toEqual(['pending', 1459]);
    expect(audit.kind).toBe('audit');
  });

  it('fails a rule whose check is wrong, with what is wrong', () => {
    const [unknown, unnamed, target] = states(
      [
        '**R1.** A.\nChecked by: count `nope`, baseline 2, target 0.',
        '**R2.** B.\nChecked by: test `tests/c.test.ts`, pending.',
        '**R3.** C.\nChecked by: count `thread-tables`, baseline 6, target 2.',
      ].join('\n\n'),
      { nope: 2, 'thread-tables': 6 },
    );
    expect(unknown.kind).toBe('failing');
    expect(unknown.problems[0]).toContain('does not define');
    expect(unnamed.kind).toBe('failing');
    expect(target.problems[0]).toContain('target of 2');
  });
});
