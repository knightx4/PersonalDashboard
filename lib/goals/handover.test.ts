import { describe, expect, it } from 'vitest';
import { locateStep, offersSend, sendJob, sendRefusal, type SendGoal } from './handover';
import { RUN_QUIET_MS } from './shaping';
import type { StepNode } from './steps';

const NOW = Date.parse('2026-10-01T12:00:00Z');

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'g',
    kind: 'claude',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    children: [],
    ...extra,
  };
}

const GOAL: SendGoal = { id: 'g', title: 'Goal', acceptance: null, status: 'open', approvedAt: '2026-09-01T00:00:00Z' };

function refusal(steps: StepNode[], id: string, runs: { itemId: string; job: string; ago: number }[] = [], goal = GOAL) {
  const target = locateStep(goal, steps, id);
  if (!target) throw new Error(`no step ${id}`);
  return sendRefusal(
    target,
    runs.map((r) => ({ itemId: r.itemId, job: r.job, createdAt: new Date(NOW - r.ago).toISOString() })),
    NOW,
  );
}

describe('sendJob and offersSend', () => {
  it('reads a Claude leaf as a step, anything with sub-steps as a phase, and your own leaf as neither', () => {
    expect(sendJob(node('a'))).toBe('step');
    expect(sendJob(node('p', { kind: 'mine', children: [node('a')] }))).toBe('phase');
    expect(sendJob(node('m', { kind: 'mine' }))).toBeNull();
    expect(sendJob(node('q', { kind: 'decision' }))).toBeNull();
    // A question beneath does not make a step a phase.
    expect(sendJob(node('m', { kind: 'mine', children: [node('q', { kind: 'decision' })] }))).toBeNull();
  });

  it('offers nothing on a closed step', () => {
    expect(offersSend(node('a', { status: 'done' }))).toBe(false);
    expect(offersSend(node('a', { status: 'proposed' }))).toBe(true);
  });
});

describe('sendRefusal', () => {
  const s = node('s');
  const phase = node('p', { kind: 'mine', children: [s] });

  it('lets a ready Claude step go', () => {
    expect(refusal([phase], 's')).toBeNull();
    expect(refusal([phase], 'p')).toBeNull();
  });

  it('refuses a step under a proposed phase', () => {
    const steps = [node('p', { kind: 'mine', status: 'proposed', children: [node('s')] })];
    expect(refusal(steps, 's')).toBe('That step sits under "p", which is still a proposal. Approve it first.');
  });

  it('refuses a goal that is closed', () => {
    expect(refusal([phase], 's', [], { ...GOAL, status: 'done' })).toBe('This goal is done, so nothing on it is sent.');
  });

  it("refuses your own step, a blocked one, and one waiting on another", () => {
    expect(refusal([node('m', { kind: 'mine' })], 'm')).toMatch(/That step is yours/);
    expect(refusal([node('b', { status: 'blocked', blockAsk: 'Your login.' })], 'b')).toBe(
      'That step is blocked: Your login.',
    );
    expect(
      refusal([node('w', { waitingOn: [{ id: 'o', title: 'Other', status: 'open' }] })], 'w'),
    ).toBe('That step waits on "Other" first.');
  });

  it('refuses a phase with nothing open in it', () => {
    const steps = [node('p', { kind: 'mine', children: [node('s', { status: 'done' })] })];
    expect(refusal(steps, 'p')).toBe('Nothing under that phase is open, so there is nothing to send.');
  });

  it('refuses a step Claude is already on through it, its phase, a step in it or the whole goal', () => {
    expect(refusal([phase], 's', [{ itemId: 's', job: 'step', ago: 60_000 }])).toMatch(/already working on this step/);
    expect(refusal([phase], 's', [{ itemId: 'p', job: 'phase', ago: 60_000 }])).toMatch(/"p", which this is part of/);
    expect(refusal([phase], 'p', [{ itemId: 's', job: 'step', ago: 60_000 }])).toMatch(/a step in this phase/);
    expect(refusal([phase], 's', [{ itemId: 'g', job: 'goal', ago: 60_000 }])).toMatch(/the whole goal/);
  });

  it('lets a run that went quiet be sent over', () => {
    expect(refusal([phase], 's', [{ itemId: 's', job: 'step', ago: RUN_QUIET_MS + 1 }])).toBeNull();
  });
});
