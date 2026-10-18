import { describe, expect, it } from 'vitest';
import type { PushPorts, PushSubscriptionRow } from '@/lib/push/send';
import {
  firstSentence,
  NOTIFY_WINDOW_HOURS,
  runStepDoneNotify,
  stepDonePayload,
  type DoneStep,
  type StepDonePorts,
} from './step-done-notify';

const NOW = new Date('2026-10-18T09:00:00Z');

function step(overrides: Partial<DoneStep> = {}): DoneStep {
  return {
    id: 'step-1',
    userId: 'user-1',
    title: 'Find three flats near the office',
    result: 'Found three flats under budget near the office. Details below.\n\n- One\n- Two',
    goalId: 'goal-1',
    ...overrides,
  };
}

describe('firstSentence', () => {
  it('takes the opening sentence of the result', () => {
    expect(firstSentence('Booked the table for Friday. More after.')).toBe('Booked the table for Friday.');
  });

  it('skips blank lines and drops heading and emphasis marks', () => {
    expect(firstSentence('\n\n## **Drafted the letter.** It is in Files.')).toBe('Drafted the letter.');
  });

  it('keeps a line with no full stop whole', () => {
    expect(firstSentence('Three options, all under budget')).toBe('Three options, all under budget');
  });

  it('is empty for an empty result', () => {
    expect(firstSentence(null)).toBe('');
    expect(firstSentence('  \n ')).toBe('');
  });
});

describe('stepDonePayload', () => {
  it('carries the title, the first sentence, the step page and the step tag', () => {
    expect(stepDonePayload(step())).toEqual({
      title: 'Find three flats near the office',
      body: 'Found three flats under budget near the office.',
      url: '/goals/goal-1/s/step-1',
      tag: 'goal-step-step-1',
    });
  });

  it('sends the title alone when nothing was written', () => {
    expect(stepDonePayload(step({ result: null })).body).toBe('');
  });

  it('clips to the lock-screen limits', () => {
    const payload = stepDonePayload(step({ title: 'word '.repeat(30), result: 'long '.repeat(60) }));
    expect(payload.title.length).toBeLessThanOrEqual(50);
    expect(payload.body.length).toBeLessThanOrEqual(180);
  });
});

function fakes(steps: DoneStep[], send: (sub: PushSubscriptionRow) => Promise<number>) {
  const notified = new Map<string, string | null>();
  const pushed: { userId: string; payload: string }[] = [];
  let since: Date | null = null;
  const ports: StepDonePorts = {
    async due(from) {
      since = from;
      return steps.filter((s) => !notified.get(s.id));
    },
    async claim(s, at) {
      if (notified.get(s.id)) return false;
      notified.set(s.id, at.toISOString());
      return true;
    },
    async release(s) {
      notified.set(s.id, null);
    },
    push(userId): PushPorts {
      return {
        subscriptions: async () => [{ id: 'sub-1', endpoint: 'e', p256dh: 'p', auth: 'a' }],
        send: async (sub, payload) => {
          pushed.push({ userId, payload });
          return send(sub);
        },
        forget: async () => {},
        sent: async () => {},
      };
    },
  };
  return { ports, notified, pushed, since: () => since };
}

describe('runStepDoneNotify', () => {
  it('sends a flagged step once and sets notified_at', async () => {
    const f = fakes([step()], async () => 201);
    const first = await runStepDoneNotify(f.ports, NOW);
    expect(first.outcomes).toEqual([{ stepId: 'step-1', kind: 'sent', push: { sent: 1, forgotten: 0, failed: 0 } }]);
    expect(f.notified.get('step-1')).toBe(NOW.toISOString());
    expect(f.pushed).toHaveLength(1);
    expect(JSON.parse(f.pushed[0].payload).title).toBe('Find three flats near the office');

    const second = await runStepDoneNotify(f.ports, NOW);
    expect(second.steps).toBe(0);
    expect(f.pushed).toHaveLength(1);
  });

  it('asks only for closes inside the window', async () => {
    const f = fakes([], async () => 201);
    await runStepDoneNotify(f.ports, NOW);
    expect(f.since()?.getTime()).toBe(NOW.getTime() - NOTIFY_WINDOW_HOURS * 3_600_000);
  });

  it('does not send a step another pass claimed', async () => {
    const f = fakes([step()], async () => 201);
    f.notified.set('step-1', 'earlier');
    const ports = { ...f.ports, due: async () => [step()] };
    const summary = await runStepDoneNotify(ports, NOW);
    expect(summary.outcomes).toEqual([{ stepId: 'step-1', kind: 'taken' }]);
    expect(f.pushed).toHaveLength(0);
  });

  it('gives the step back when every send failed', async () => {
    const f = fakes([step()], async () => {
      throw new Error('push service down');
    });
    const summary = await runStepDoneNotify(f.ports, NOW);
    expect(summary.outcomes[0].kind).toBe('retry');
    expect(f.notified.get('step-1')).toBeNull();
  });

  it('leaves the step unclaimed when nothing can be signed', async () => {
    const f = fakes([step()], async () => 201);
    const summary = await runStepDoneNotify({ ...f.ports, push: () => null }, NOW);
    expect(summary.outcomes).toEqual([{ stepId: 'step-1', kind: 'unsigned' }]);
    expect(f.notified.has('step-1')).toBe(false);
  });
});
