import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { PULLS_PER_DAY, dayOf, goalOfTopic, outcomeOfRun, pickTopics, pullForLitTopics } = await import('./lit-topic-pull');
type Topic = import('./lit-topic-pull').LitTopic;
type Ports = import('./lit-topic-pull').LitTopicPorts;
type Line = import('./lit-topic-pull').TopicPullLine;
type Prior = Map<string, import('./lit-topic-pull').PriorPull>;

const topic = (n: number): Topic => ({
  id: `t${n}`,
  title: `Topic ${n}`,
  parentTitle: 'Economics',
  litAt: `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00Z`,
});

const NOW = new Date('2026-10-16T12:00:00Z');

function ports(over: Partial<Ports> & { lit: Topic[]; usedToday?: number; prior?: Prior }) {
  const recorded: Line[] = [];
  const pulled: string[] = [];
  const { lit, usedToday, prior, ...rest } = over;
  const p: Ports = {
    litTopics: async () => lit,
    history: async () => ({ prior: prior ?? new Map(), today: usedToday ?? 0 }),
    classify: async () => ({ ok: true, kind: 'academic_course' }),
    pull: async (provider, goal) => {
      pulled.push(`${provider}:${goal.name}`);
      return { provider, ok: true, lines: [{ candidate: 'x', status: 'stored', itemId: `item-${goal.name}`, units: 5, unchanged: false }] };
    },
    record: async (line) => {
      recorded.push(line);
    },
    outOfTime: () => false,
    ...rest,
  };
  return { p, recorded, pulled };
}

describe('picking the topics to pull for', () => {
  it('takes the newest lit first, skips the done and the failed today, and stops at the allowance', () => {
    const lit = [topic(1), topic(2), topic(3), topic(4)];
    const prior: Prior = new Map([
      ['t4', { outcome: 'stored', pulledOn: '2026-10-15' }],
      ['t3', { outcome: 'failed', pulledOn: '2026-10-16' }],
      ['t2', { outcome: 'failed', pulledOn: '2026-10-15' }],
    ]);
    expect(pickTopics({ lit, prior, today: '2026-10-16', allowance: 5 }).map((t) => t.id)).toEqual(['t2', 't1']);
    expect(pickTopics({ lit, prior: new Map(), today: '2026-10-16', allowance: 2 }).map((t) => t.id)).toEqual(['t4', 't3']);
    expect(pickTopics({ lit, prior: new Map(), today: '2026-10-16', allowance: 0 })).toEqual([]);
  });

  it('leaves out a frame topic a prepared subject refines, and reads its kind instead of classifying', async () => {
    const lit = [{ ...topic(1), prepared: true }, topic(2), { ...topic(3), subjectKind: 'practical_skill' as const }];
    expect(pickTopics({ lit, prior: new Map(), today: '2026-10-16', allowance: 5 }).map((t) => t.id)).toEqual(['t3', 't2']);
    const classify = vi.fn(async () => ({ ok: true as const, kind: 'academic_course' as const }));
    const { p, pulled } = ports({ lit, classify });
    await pullForLitTopics(p, NOW);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(pulled).not.toContain('ocw:Topic 1');
  });

  it('tells the classifier the parent topic', () => {
    expect(goalOfTopic(topic(1))).toEqual({ name: 'Topic 1', about: 'A topic within Economics.' });
    expect(goalOfTopic({ ...topic(1), parentTitle: null }).about).toBeNull();
    expect(dayOf(NOW)).toBe('2026-10-16');
  });
});

describe('a day of pulls', () => {
  it('pulls the first provider of the kind once per topic and never more than five topics', async () => {
    const lit = Array.from({ length: 8 }, (_, i) => topic(i + 1));
    const { p, recorded, pulled } = ports({ lit });
    const summary = await pullForLitTopics(p, NOW);
    expect(PULLS_PER_DAY).toBe(5);
    expect(recorded).toHaveLength(5);
    expect(pulled).toHaveLength(5);
    expect(pulled[0]).toBe('ocw:Topic 8');
    expect(summary.lines.every((l) => l.outcome === 'stored' && l.itemId)).toBe(true);
  });

  it('counts what was already pulled today against the five', async () => {
    const { p, recorded } = ports({ lit: [topic(1), topic(2), topic(3)], usedToday: 4 });
    await pullForLitTopics(p, NOW);
    expect(recorded).toHaveLength(1);
    const none = ports({ lit: [topic(1)], usedToday: 5 });
    expect((await pullForLitTopics(none.p, NOW)).lines).toEqual([]);
    expect(none.pulled).toEqual([]);
  });

  it('records nothing when no kind comes back, records a failed classification, and survives a throw', async () => {
    const answers: Awaited<ReturnType<Ports['classify']>>[] = [
      { ok: true, kind: null },
      { ok: false, detail: 'Rate limited.' },
      { ok: true, kind: null },
    ];
    let i = 0;
    const { p, recorded } = ports({ lit: [topic(1), topic(2), topic(3)], classify: async () => answers[i++]! });
    const summary = await pullForLitTopics(p, NOW);
    expect(summary.lines.map((l) => l.outcome)).toEqual(['nothing', 'failed', 'nothing']);
    expect(recorded.map((l) => l.provider)).toEqual([null, null, null]);

    const thrown = ports({
      lit: [topic(1)],
      pull: async () => {
        throw new Error('fetch refused');
      },
    });
    const line = (await pullForLitTopics(thrown.p, NOW)).lines[0]!;
    expect(line).toMatchObject({ outcome: 'failed', provider: 'ocw', detail: 'fetch refused' });
  });

  it('stops when time is up', async () => {
    const { p, recorded } = ports({ lit: [topic(1), topic(2)], outOfTime: () => true });
    await pullForLitTopics(p, NOW);
    expect(recorded).toEqual([]);
  });

  it('reads a run: a stored line wins, a failure is failed, no line is nothing', () => {
    expect(outcomeOfRun({ provider: 'ocw', ok: false, detail: 'x' }).outcome).toBe('failed');
    expect(outcomeOfRun({ provider: 'ocw', ok: true, lines: [] }).outcome).toBe('nothing');
    expect(
      outcomeOfRun({
        provider: 'ocw',
        ok: true,
        lines: [
          { candidate: 'a', status: 'not-confirmed', detail: 'n' },
          { candidate: 'b', status: 'stored', itemId: 'i', units: 3, unchanged: true },
        ],
      }),
    ).toEqual({ outcome: 'stored', itemId: 'i' });
  });
});
