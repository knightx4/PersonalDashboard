import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_KIND,
  blockPatch,
  isPlanBlockKind,
  isPlanKind,
  isPlanStatus,
  planItemFromRow,
} from '@/lib/plan/load';
import { PLAN_SEED } from '@/lib/plan/seed';
import { MODULES } from '@/lib/modules';

describe('planItemFromRow', () => {
  const row = {
    id: 'id',
    number: 12,
    module: 'shopping',
    parent_id: null,
    title: 'A step',
    detail: null,
    acceptance: 'Done when it works.',
    status: 'blocked',
    kind: 'build',
    fog: null,
    resolution: null,
    comment: null,
    priority: 1,
    size: 'm',
    assignee: 'me',
    commit_sha: null,
    position: 10,
    started_at: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('reads a row as the app sees it', () => {
    const item = planItemFromRow(row);
    expect(item.number).toBe(12);
    expect(item.status).toBe('blocked');
    expect(item.priority).toBe(1);
    expect(item.size).toBe('m');
    expect(item.assignee).toBe('me');
    expect(item.acceptance).toBe('Done when it works.');
    expect(item.kind).toBe('build');
  });

  it('round-trips a decision with its fog and its answer', () => {
    const item = planItemFromRow({
      ...row,
      status: 'done',
      kind: 'decision',
      fog: 'How the export is shaped is not yet known.',
      resolution: 'One file per month.',
    });
    expect(item.kind).toBe('decision');
    expect(item.fog).toBe('How the export is shaped is not yet known.');
    expect(item.resolution).toBe('One file per month.');
  });

  it('round-trips a setup step as its own kind rather than as work to build', () => {
    // 0084. A row the person has to act on reads back as `setup`; before the
    // kind existed it fell through to `build` and looked like something a
    // session could pick up.
    const item = planItemFromRow({
      ...row,
      status: 'not_started',
      kind: 'setup',
      title: 'Add the Mailgun DNS records',
    });
    expect(item.kind).toBe('setup');
  });

  it('reads which kind of block a blocked step is carrying', () => {
    expect(planItemFromRow({ ...row, block_kind: 'steps' }).blockKind).toBe('steps');
    expect(planItemFromRow({ ...row, block_kind: 'outside' }).blockKind).toBe('outside');
  });

  it('reads no kind on a step that is not blocked, and none on a row written before 0081', () => {
    expect(planItemFromRow({ ...row, status: 'not_started' }).blockKind).toBeNull();
    expect(planItemFromRow(row).blockKind).toBeNull();
    // A word nothing names is read back as none rather than handed on to a
    // switch that has no arm for it.
    expect(planItemFromRow({ ...row, block_kind: 'somebody' }).blockKind).toBeNull();
  });

  it('reads a step still holding the old claude value as nobody\'s', () => {
    // #718. The column says which approved steps you kept, and `me` is the
    // whole of that answer, so the two dozen rows a hand-over wrote load as
    // nobody's -- which is what `isClaudes` already counts as the runner's.
    expect(planItemFromRow({ ...row, assignee: 'claude' }).assignee).toBeNull();
  });

  it('reads a value the code no longer names back as the default rather than crashing', () => {
    // A module removed from lib/modules, a status a later migration dropped, a
    // size somebody typed into the database by hand.
    const item = planItemFromRow({
      ...row,
      module: 'retired',
      status: 'someday',
      priority: 9,
      size: 'xxl',
      assignee: 'them',
      kind: 'question',
    });
    expect(item.module).toBeNull();
    expect(item.status).toBe('not_started');
    expect(item.priority).toBe(2);
    expect(item.size).toBeNull();
    expect(item.assignee).toBeNull();
    expect(item.kind).toBe('build');
  });
});

describe('the seed', () => {
  it('names only modules that exist', () => {
    const ids = new Set<string>(MODULES.map((module) => module.id));
    for (const step of PLAN_SEED) {
      if (step.module === null) continue;
      expect(ids.has(step.module), `${step.title} names ${step.module}`).toBe(true);
    }
  });

  it('carries only real statuses', () => {
    for (const step of PLAN_SEED) {
      expect(isPlanStatus(step.status), `${step.title} is ${step.status}`).toBe(true);
    }
  });

  it('has a title on every step, within what the column accepts', () => {
    for (const step of PLAN_SEED) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.title.length).toBeLessThanOrEqual(200);
      expect((step.detail ?? '').length).toBeLessThanOrEqual(4000);
    }
  });

  it('does not name the same step twice within one module', () => {
    const seen = new Set<string>();
    for (const step of PLAN_SEED) {
      const key = `${step.module ?? 'app'}:${step.title}`;
      expect(seen.has(key), `${key} appears twice`).toBe(false);
      seen.add(key);
    }
  });
});

describe('blockPatch', () => {
  it('records the kind it is given when a step becomes blocked', () => {
    expect(blockPatch('blocked', 'steps')).toEqual({ block_kind: 'steps' });
    expect(blockPatch('blocked', 'outside')).toEqual({ block_kind: 'outside' });
  });

  it('takes a block nobody described as waiting on the person', () => {
    // The safe way to be wrong: a block that outlives its reason is a row
    // somebody looks at, and one that clears itself early is the afternoon
    // three sessions lost on #499.
    expect(DEFAULT_BLOCK_KIND).toBe('outside');
    expect(blockPatch('blocked')).toEqual({ block_kind: 'outside' });
    expect(blockPatch('blocked', null)).toEqual({ block_kind: 'outside' });
  });

  it('leaves the ask alone while a step stays blocked', () => {
    expect(blockPatch('blocked', 'steps')).not.toHaveProperty('block_ask');
  });

  it('clears both columns on every status that is not blocked', () => {
    for (const status of ['not_started', 'in_progress', 'done', 'dropped', 'proposed'] as const) {
      expect(blockPatch(status)).toEqual({ block_kind: null, block_ask: null });
      // Even asked for one: a step that is not blocked is not waiting on
      // anything, whatever the caller passed.
      expect(blockPatch(status, 'steps')).toEqual({ block_kind: null, block_ask: null });
    }
  });
});

describe('isPlanBlockKind', () => {
  it('names two kinds and nothing else', () => {
    expect(isPlanBlockKind('steps')).toBe(true);
    expect(isPlanBlockKind('outside')).toBe(true);
    expect(isPlanBlockKind('blocked')).toBe(false);
    expect(isPlanBlockKind('')).toBe(false);
  });
});

describe('isPlanKind', () => {
  it('names three kinds and nothing else', () => {
    expect(isPlanKind('build')).toBe(true);
    expect(isPlanKind('decision')).toBe(true);
    expect(isPlanKind('setup')).toBe(true);
    // The word the database refuses, and the one nothing writes.
    expect(isPlanKind('question')).toBe(false);
    expect(isPlanKind('')).toBe(false);
  });
});
