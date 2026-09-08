import { describe, expect, it } from 'vitest';
import { isPlanStatus, planItemFromRow } from '@/lib/plan/load';
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
    comment: null,
    priority: 1,
    size: 'm',
    assignee: 'claude',
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
    expect(item.assignee).toBe('claude');
    expect(item.acceptance).toBe('Done when it works.');
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
    });
    expect(item.module).toBeNull();
    expect(item.status).toBe('not_started');
    expect(item.priority).toBe(2);
    expect(item.size).toBeNull();
    expect(item.assignee).toBeNull();
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
