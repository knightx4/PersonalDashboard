import { describe, expect, it } from 'vitest';

import type { RunActivity } from '@/lib/core/run-activities';
import type { FeatureStep } from '@/lib/digest/night';
import { featureLines, groupLines } from './feature-lines';

let n = 0;
function line(body: string, kind: RunActivity['kind'] = 'thought'): RunActivity {
  n += 1;
  return {
    id: `l${n}`,
    user_id: 'u',
    run_table: 'plan_runs',
    run_id: 'r',
    kind,
    body,
    options: null,
    created_at: new Date(Date.UTC(2026, 9, 15, 14, 0, n)).toISOString(),
  };
}

const STEPS: FeatureStep[] = [
  { ref: '#2124.1', title: 'Store the details', status: 'done' },
  { ref: '#2124.2', title: 'Details tab on You', status: 'in_progress' },
  { ref: '#2124.3', title: 'Edit in place', status: 'not_started' },
];

describe('featureLines', () => {
  it('puts each line under the step it names, and carries on under it until another is named', () => {
    const { buckets } = featureLines(
      [
        line('Checking the due check-backs before sending step #2124.1 to a builder.'),
        line('The untracked item is the builder working copy.'),
        line('Claimed #2124.2', 'action'),
        line('Waiting on the builder.'),
      ],
      '#2124',
      STEPS,
    );
    expect(buckets.map((b) => [b.key, b.count])).toEqual([
      ['#2124.1', 2],
      ['#2124.2', 2],
      ['#2124.3', 0],
    ]);
  });

  it('keeps every step, in plan order, even those with nothing written yet', () => {
    const { buckets } = featureLines([], '#2124', STEPS);
    expect(buckets.map((b) => b.title)).toEqual(['Store the details', 'Details tab on You', 'Edit in place']);
  });

  it('reads a step written without its hash', () => {
    const { buckets } = featureLines([line('Sent a helper to build plan step 2124.2')], '#2124', STEPS);
    expect(buckets.find((b) => b.key === '#2124.2')?.count).toBe(1);
  });

  it('files a sub-step under the step above it', () => {
    const { buckets } = featureLines([line('Claimed #2124.2.1', 'action')], '#2124', STEPS);
    expect(buckets.find((b) => b.key === '#2124.2')?.count).toBe(1);
  });

  it('leaves out lines about another feature and counts them', () => {
    const { buckets, hidden } = featureLines(
      [line('Claimed #2124.1', 'action'), line('Woke the session on #1980.'), line('Gate run #4 is going.')],
      '#2124',
      STEPS,
    );
    expect(hidden).toBe(1);
    expect(buckets.flatMap((b) => b.groups.map((g) => g.line.body))).not.toContain('Woke the session on #1980.');
  });

  it('gathers lines before any step under their own heading, and the gate under landing', () => {
    const { buckets } = featureLines(
      [
        line('Reading the plan.'),
        line('Claimed #2124.1', 'action'),
        line('The gate is running in the background.'),
        line('Still waiting.'),
      ],
      '#2124',
      STEPS,
    );
    expect(buckets[0]).toMatchObject({ key: 'start', count: 1 });
    expect(buckets[buckets.length - 1]).toMatchObject({ key: 'landing', count: 2 });
  });
});

describe('groupLines', () => {
  it('draws a line said again straight after itself once, with a count', () => {
    const groups = groupLines([line('Claimed #2124.1', 'action'), line('Claimed #2124.1', 'action')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].repeats).toBe(2);
  });

  it('draws a run of file changes as one line naming the files', () => {
    const groups = groupLines([
      line('Writing supabase/migrations-you/0007_details.sql', 'action'),
      line('Writing lib/you/details-store.test.ts', 'action'),
      line('Editing tests/rls-you.test.ts', 'action'),
      line('Pushed', 'action'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].summary).toBe('Changed 3 files');
    expect(groups[0].files).toEqual([
      'supabase/migrations-you/0007_details.sql',
      'lib/you/details-store.test.ts',
      'tests/rls-you.test.ts',
    ]);
  });

  it('never folds a question or an answer', () => {
    expect(groupLines([line('Which?', 'question'), line('Which?', 'question')])).toHaveLength(2);
  });
});
