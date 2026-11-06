import { describe, expect, it } from 'vitest';
import { reshapeOrigin } from './origin';
import { reviseRefusal, revisedComment, type ReviseTarget } from './revise';

const target: ReviseTarget = {
  kind: 'build',
  status: 'not_started',
  parent_id: 'feature',
  title: 'Add the date column',
  acceptance: 'A migration adds orders.placed_on.',
  detail: null,
  comment: null,
};

const ok = {
  target,
  targetRef: '#12.3',
  source: { kind: 'build', status: 'in_progress', commit_sha: 'abc123' },
  sourceRef: '#12.1',
  sameFeature: true,
  change: { doneWhen: 'The page reads orders.created_at.' },
  finding: 'Orders already carry created_at.',
};

describe('reviseRefusal', () => {
  it('lets a built step revise a later one under the same feature', () => {
    expect(reviseRefusal(ok)).toBeNull();
    expect(reviseRefusal({ ...ok, source: { ...ok.source, status: 'done', commit_sha: null } })).toBeNull();
    expect(reviseRefusal({ ...ok, target: { ...target, status: 'proposed' } })).toBeNull();
  });

  it('never rewrites the feature itself', () => {
    expect(reviseRefusal({ ...ok, target: { ...target, parent_id: null } })).toMatch(/decision/);
  });

  it('leaves a step somebody has started, blocked or closed alone', () => {
    for (const status of ['in_progress', 'blocked', 'done', 'dropped']) {
      expect(reviseRefusal({ ...ok, target: { ...target, status } })).toMatch(/nobody has started/);
    }
  });

  it('only revises build steps, and only from a built build step', () => {
    expect(reviseRefusal({ ...ok, target: { ...target, kind: 'decision' } })).toMatch(/not a build/);
    expect(reviseRefusal({ ...ok, source: { ...ok.source, kind: 'decision' } })).toMatch(/re-shape/);
    expect(
      reviseRefusal({ ...ok, source: { kind: 'build', status: 'in_progress', commit_sha: null } }),
    ).toMatch(/not been built/);
    expect(
      reviseRefusal({ ...ok, source: { kind: 'build', status: 'not_started', commit_sha: null } }),
    ).toMatch(/not been built/);
  });

  it('keeps to one feature, and wants a reason and a change', () => {
    expect(reviseRefusal({ ...ok, sameFeature: false })).toMatch(/different features/);
    expect(reviseRefusal({ ...ok, finding: ' ' })).toMatch(/--because/);
    expect(reviseRefusal({ ...ok, change: {} })).toMatch(/at least one/);
  });
});

describe('revisedComment', () => {
  it('stamps the cause and keeps what the row said before', () => {
    const comment = revisedComment({
      comment: 'Added by session cse_1 on 2026-11-01.',
      target,
      change: { doneWhen: 'The page reads orders.created_at.', title: target.title },
      sourceOutline: '12.1',
      finding: 'Orders already carry created_at.',
      date: '2026-11-04',
    });
    expect(comment).toBe(
      [
        'Added by session cse_1 on 2026-11-01.',
        '',
        "From #12.1's build: Orders already carry created_at.",
        'Revised 2026-11-04 by the batch building this feature.',
        'Done-when was: A migration adds orders.placed_on.',
      ].join('\n'),
    );
    expect(reshapeOrigin(comment)?.source).toBe('build');
  });
});
