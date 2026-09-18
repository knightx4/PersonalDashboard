import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree, findNode, healthOf, isWaitingOnThePerson, workOrder } from '@/lib/plan/tree';
import {
  needsLines,
  needsRefusal,
  releasesBlock,
  SETUP_ASSIGNEE,
  SETUP_KIND,
  setupHome,
  setupStartRefusal,
  type WaitingStep,
} from './needs';

/**
 * The rules behind `plan.ts needs "…" --for <n>`.
 *
 * The command itself cannot be run without DATABASE_URL, so everything it
 * decides lives here and is pinned here: where the row goes, what is refused,
 * what happens to the step that was stopped, and what is said afterwards.
 */

function step(over: Partial<WaitingStep> = {}): WaitingStep {
  return {
    id: 'a',
    number: 12,
    parentId: 'feature',
    kind: 'build',
    status: 'in_progress',
    ...over,
  };
}

describe('setupHome', () => {
  it('puts the job under the feature the stopped step belongs to', () => {
    const waiting = step({ id: 'child', number: 12, parentId: 'feature' });
    const parent = step({ id: 'feature', number: 7, parentId: null });
    expect(setupHome(waiting, parent).id).toBe('feature');
  });

  it('puts it under the step itself when that step is the feature', () => {
    const feature = step({ id: 'feature', number: 7, parentId: null });
    expect(setupHome(feature, null).id).toBe('feature');
  });

  // A parent id with no row fetched for it is the caller's bug, not a reason
  // to write the row at the top of a module where nothing will find it.
  it('falls back to the step itself when the parent could not be read', () => {
    expect(setupHome(step({ id: 'child', parentId: 'gone' }), null).id).toBe('child');
  });
});

describe('needsRefusal', () => {
  it('writes the job against work that is stopped', () => {
    expect(needsRefusal(step())).toBeNull();
    expect(needsRefusal(step({ status: 'blocked' }))).toBeNull();
    expect(needsRefusal(step({ status: 'not_started' }))).toBeNull();
    // A question waiting on a key is rarer than a build waiting on one, but it
    // is the same wall and the same edge.
    expect(needsRefusal(step({ kind: 'decision' }))).toBeNull();
  });

  it('refuses a step that is already finished, since nothing waits on it', () => {
    expect(needsRefusal(step({ status: 'done' }))).toContain('already closed');
    expect(needsRefusal(step({ status: 'dropped' }))).toContain('already closed');
  });

  it('refuses pointing one setup job at another', () => {
    expect(needsRefusal(step({ kind: 'setup' }))).toContain('itself a setup job');
  });
});

describe('releasesBlock', () => {
  it('takes the stopped work off blocked, so it reads as waiting on the job', () => {
    expect(releasesBlock('blocked')).toBe(true);
  });

  it('leaves every other status alone', () => {
    expect(releasesBlock('in_progress')).toBe(false);
    expect(releasesBlock('not_started')).toBe(false);
    expect(releasesBlock('proposed')).toBe(false);
  });
});

describe('needsLines', () => {
  const outcome = {
    setupNumber: 605,
    title: 'Set GITHUB_TOKEN in Vercel',
    parentNumber: 494,
    waitingNumber: 501,
    released: false,
    hasDetail: true,
  };

  it('prints both numbers it wrote and where they went', () => {
    const lines = needsLines(outcome);
    expect(lines[0]).toBe('#605 for you to set up, under #494: Set GITHUB_TOKEN in Vercel');
    expect(lines[1]).toBe('#501 waits on #605.');
    expect(lines).toHaveLength(2);
  });

  it('says so when the stopped step came off blocked', () => {
    const lines = needsLines({ ...outcome, released: true });
    expect(lines.join('\n')).toContain('back to not started');
  });

  it('says so when there is nothing but the summary to go on', () => {
    const lines = needsLines({ ...outcome, hasDetail: false });
    expect(lines.join('\n')).toContain('no --detail');
  });
});

describe('setupStartRefusal', () => {
  // A refusal that does not say where the job is closed is how a session ends
  // up inventing a way to close it.
  it('names where the job is closed instead', () => {
    const refusal = setupStartRefusal(605);
    expect(refusal).toContain('#605');
    expect(refusal).toContain('/dev/plan');
    expect(refusal).toContain('I have set this up');
  });
});

describe('the row a setup job is written as', () => {
  it('is a setup step of yours, never Claude’s', () => {
    expect(SETUP_KIND).toBe('setup');
    expect(SETUP_ASSIGNEE).toBe('me');
  });
});

/**
 * What the rows `needs` writes then read as.
 *
 * The command cannot be run without a database, so the end state it leaves is
 * pinned here instead: the shape of the two rows, put through the same
 * `buildPlanTree` the page and the CLI both read with. If this stops holding,
 * the command is writing rows that do not say what it printed.
 */
describe('the plan after a needs', () => {
  const stopped: PlanItem = {
    id: 'stopped',
    number: 501,
    module: 'dev',
    parentId: 'feature',
    title: 'Ship the nightly check',
    detail: null,
    acceptance: null,
    // Off blocked, because the dependency is now what says it is waiting.
    status: 'not_started',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: 'Blocked 2026-09-01: needs a token.',
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: 'claude',
    commitSha: null,
    position: 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const feature: PlanItem = { ...stopped, id: 'feature', number: 494, parentId: null, position: 10 };
  // Exactly the row the insert writes: setup, the person's, under the feature.
  const job: PlanItem = {
    ...stopped,
    id: 'job',
    number: 605,
    title: 'Set GITHUB_TOKEN in Vercel',
    detail: 'Project settings → Environment Variables, all three environments.',
    kind: SETUP_KIND,
    assignee: SETUP_ASSIGNEE,
    comment: null,
    position: 20,
  };
  const sections = buildPlanTree({
    items: [feature, stopped, job],
    dependencies: [{ id: 'edge', itemId: stopped.id, dependsOnId: job.id }],
  });
  const node = (id: string) => findNode(sections, id)!;

  it('leaves the stopped work waiting on the job rather than blocked', () => {
    expect(node('stopped').waitingOn.map((ref) => ref.number)).toEqual([605]);
    expect(node('stopped').ready).toBe(false);
    expect(node('stopped').blockAsk).toBeNull();
  });

  it('reads the job as one of yours, and never as work to hand out', () => {
    expect(healthOf(node('job'))).toBe('setup');
    expect(isWaitingOnThePerson(node('job'))).toBe(true);
    expect(workOrder(sections, { assignee: 'claude' }).map((n) => n.number)).not.toContain(605);
  });

  it('frees the work when you close the job, with nothing else to clear', () => {
    const closed = buildPlanTree({
      items: [feature, stopped, { ...job, status: 'done' }],
      dependencies: [{ id: 'edge', itemId: stopped.id, dependsOnId: job.id }],
    });
    expect(findNode(closed, 'stopped')!.ready).toBe(true);
  });
});
