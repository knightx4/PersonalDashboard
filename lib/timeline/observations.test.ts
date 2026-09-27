import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { checkObservations, observationWeek, overlap, parseEventRef, stripEventLabels, summariseTimeline, weekOf } =
  await import(
  './observations'
);
const { observationsPrompt, writeObservations } = await import('./observations-model');
const { runObservationsFor } = await import('./observations-run');
import type { ObservationRow, ObservationRunPorts } from './observations-run';
import type { RawObservation } from './observations';
import { eventRef, type TimelineEvent } from './timeline';

function event(partial: Partial<TimelineEvent> & Pick<TimelineEvent, 'occurred_at' | 'module' | 'kind'>): TimelineEvent {
  return {
    title: 'Something',
    detail: null,
    amount_cents: null,
    currency: null,
    source_table: 'public.orders',
    source_id: Math.random().toString(36).slice(2),
    link_ref: null,
    ...partial,
  };
}

const rejection = event({
  occurred_at: '2026-09-08T09:00:00Z',
  module: 'jobs',
  kind: 'rejected',
  title: 'Acme, Data Analyst',
  detail: 'screening',
  source_table: 'job_search.application_events',
  source_id: 'rej-1',
});
const order = event({
  occurred_at: '2026-09-10T12:00:00Z',
  module: 'shopping',
  kind: 'ordered',
  title: 'Headphones',
  amount_cents: 8999,
  currency: 'GBP',
  source_table: 'public.orders',
  source_id: 'ord-1',
});
const secondOrder = event({
  occurred_at: '2026-09-11T12:00:00Z',
  module: 'shopping',
  kind: 'ordered',
  title: 'Books',
  amount_cents: 2500,
  currency: 'GBP',
  source_table: 'public.orders',
  source_id: 'ord-2',
});
const note = event({
  occurred_at: '2026-08-04T20:00:00Z',
  module: 'vault',
  kind: 'note_written',
  title: 'Journal/Tuesday.md',
  source_table: 'obsidian.notes',
  source_id: 'note-1',
});

// A Monday afternoon, as the cron fires.
const MONDAY = new Date('2026-09-28T14:07:00Z');

describe('the week a run writes for', () => {
  it('keys a run by its Monday and reads the twelve whole weeks before it', () => {
    expect(observationWeek(MONDAY)).toEqual({
      week: '2026-09-28',
      from: '2026-07-06T00:00:00.000Z',
      to: '2026-09-28T00:00:00.000Z',
    });
  });

  it('gives a Sunday the Monday before it', () => {
    expect(observationWeek(new Date('2026-09-27T23:59:00Z')).week).toBe('2026-09-21');
    expect(weekOf('2026-09-27T23:59:00Z')).toBe('2026-09-21');
  });
});

describe('the summary the model reads', () => {
  const window = observationWeek(MONDAY);
  const input = summariseTimeline([secondOrder, rejection, order, note], window);

  it('has a line for each of the twelve weeks, with counts and spend', () => {
    const weekLines = input.summary.split('\n').filter((line) => line.startsWith('Week of '));
    expect(weekLines).toHaveLength(12);
    expect(input.summary).toContain('Week of 2026-09-07: 2 orders, 1 rejection. Spent: GBP 114.99.');
    expect(input.summary).toContain('Week of 2026-08-03: 1 note. Spent: none.');
    expect(input.summary).toContain('Week of 2026-07-13: nothing recorded.');
  });

  it('totals spend by month', () => {
    expect(input.summary).toContain('2026-09: GBP 114.99');
  });

  it('lists every event oldest first under a short id', () => {
    expect([...input.events.keys()]).toEqual(['E1', 'E2', 'E3', 'E4']);
    expect(input.events.get('E1')).toBe(note);
    expect(input.events.get('E2')).toBe(rejection);
    expect(input.summary).toContain('E2 | 2026-09-08 | jobs rejection | Acme, Data Analyst | screening');
    expect(input.summary).toContain('E3 | 2026-09-10 | shopping order | Headphones | GBP 89.99');
  });
});

describe('taking event ids out of what the person reads', () => {
  it('removes bracketed ids, ranges and lists with their brackets', () => {
    expect(
      stripEventLabels(
        'The week of 2026-09-14 combined 4 interviews (including four Galaxy Digital onsites just after) with a burst of 71 notes, most being course notes (E317-E380) rather than job related notes.',
      ),
    ).toBe(
      'The week of 2026-09-14 combined 4 interviews (including four Galaxy Digital onsites just after) with a burst of 71 notes, most being course notes rather than job related notes.',
    );
    expect(stripEventLabels('You wrote 3 notes [E1, E2 and E5], then 2 more (E7 to E8).')).toBe(
      'You wrote 3 notes, then 2 more.',
    );
    expect(stripEventLabels('You placed 2 orders (E3–E4).')).toBe('You placed 2 orders.');
  });

  it('gives null when an id is left in the running text', () => {
    expect(
      stripEventLabels(
        'Task completions and note writing only show up in the last three weeks of the period, alongside a run of four onsite interviews at Galaxy Digital on 2026-09-15 (E298-E301) and recruiter screens like E268 and E247.',
      ),
    ).toBeNull();
    expect(stripEventLabels('You did 2 things (see E4).')).toBeNull();
  });

  it('leaves text with no ids alone, including words that start with E', () => {
    expect(stripEventLabels('Every one of your 12 EU orders (E-commerce) arrived.')).toBe(
      'Every one of your 12 EU orders (E-commerce) arrived.',
    );
  });
});

describe('the checks on what the model gave', () => {
  const window = observationWeek(MONDAY);
  const { events } = summariseTimeline([note, rejection, order, secondOrder], window);
  // E1 note, E2 rejection, E3 order, E4 second order.
  const good: RawObservation = {
    sentence: 'You placed 2 orders worth GBP 114.99 in the three days after the Acme rejection',
    evidence: ['E2', 'E3', 'E4'],
  };

  it('keeps an observation that crosses modules, cites real rows and has a number', () => {
    const { kept, dropped } = checkObservations([good], events, []);
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        sentence: 'You placed 2 orders worth GBP 114.99 in the three days after the Acme rejection.',
        evidence: [eventRef(rejection), eventRef(order), eventRef(secondOrder)],
        modules: ['shopping', 'jobs'],
      },
    ]);
  });

  it('drops one citing an id that was not in the summary', () => {
    const { kept, dropped } = checkObservations([{ ...good, evidence: ['E2', 'E3', 'E99'] }], events, []);
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['unknown-evidence']);
  });

  it('drops one resting on a single module', () => {
    const { kept, dropped } = checkObservations(
      [{ sentence: 'You placed 2 orders in one week.', evidence: ['E3', 'E4'] }],
      events,
      [],
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['one-module']);
  });

  it('drops one without a number, and one without a sentence', () => {
    const { dropped } = checkObservations(
      [
        { sentence: 'You shop after rejections.', evidence: ['E2', 'E3'] },
        { sentence: '  ', evidence: ['E2', 'E3'] },
        { evidence: ['E2', 'E3'] },
      ],
      events,
      [],
    );
    expect(dropped).toEqual(['no-number', 'no-sentence', 'no-sentence']);
  });

  it('takes bracketed event ids out of the sentence and keeps it', () => {
    const { kept, dropped } = checkObservations(
      [{ sentence: 'You placed 2 orders (E3, E4) in the three days after the Acme rejection (E2)', evidence: ['E2', 'E3', 'E4'] }],
      events,
      [],
    );
    expect(dropped).toEqual([]);
    expect(kept[0]!.sentence).toBe('You placed 2 orders in the three days after the Acme rejection.');
  });

  it('drops one with an event id in its running text', () => {
    const { kept, dropped } = checkObservations(
      [
        {
          sentence: 'Task completions came alongside four onsite interviews (E2) and recruiter screens like E3 and E4.',
          evidence: ['E2', 'E3', 'E4'],
        },
        { sentence: 'You placed 2 orders (E3 and a return) after the rejection.', evidence: ['E2', 'E3'] },
      ],
      events,
      [],
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['event-label', 'event-label']);
  });

  it('drops a rewording of one marked not useful', () => {
    const { kept, dropped } = checkObservations(
      [{ sentence: 'In the 3 days after the Acme rejection you placed 2 orders worth GBP 114.99.', evidence: ['E2', 'E3'] }],
      events,
      ['You placed 2 orders worth GBP 114.99 in the three days after the Acme rejection.'],
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['repeat']);
  });

  it('keeps no more than three', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      sentence: `Pattern ${index + 1} held in ${index + 2} weeks.`,
      evidence: ['E1', 'E2'],
    }));
    const { kept, dropped } = checkObservations(many, events, []);
    expect(kept).toHaveLength(3);
    expect(dropped).toEqual(['over-limit', 'over-limit']);
  });

  it('scores word overlap', () => {
    expect(overlap('orders after rejections', 'orders after rejections')).toBe(1);
    expect(overlap('orders after rejections', 'notes during interviews')).toBe(0);
  });

  it('reads a ref back into its table and id', () => {
    expect(parseEventRef('job_search.application_events:rej-1')).toEqual({
      sourceTable: 'job_search.application_events',
      sourceId: 'rej-1',
    });
    expect(parseEventRef('not a ref')).toBeNull();
  });
});

describe('the model call', () => {
  function stubClient(input: unknown) {
    const create = vi.fn(async () => ({
      content: [{ type: 'tool_use', id: 't1', name: 'report_observations', input }],
      usage: { input_tokens: 5000, output_tokens: 200 },
    }));
    return { create, client: { messages: { create } } as never };
  }

  it('forces the tool, sends the lists to avoid, and returns what it reported', async () => {
    const { create, client } = stubClient({ observations: [{ sentence: 'x 1', evidence: ['E1'] }] });
    const onSpend = vi.fn();
    const result = await writeObservations(
      { summary: 'SUMMARY', notUseful: ['Old one.'], recent: [] },
      { apiKey: 'k', client, onSpend },
    );
    expect(result).toEqual([{ sentence: 'x 1', evidence: ['E1'] }]);
    const request = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(request.model).toBe('claude-sonnet-5');
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'report_observations' });
    expect(JSON.stringify(request.messages)).toContain('Marked not useful:\\n- Old one.');
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5' }));
  });

  it('reads an empty list as a quiet week', async () => {
    const { client } = stubClient({ observations: [] });
    expect(await writeObservations({ summary: 'S', notUseful: [], recent: [] }, { apiKey: 'k', client })).toEqual([]);
  });

  it('puts the summary after what to avoid', () => {
    const prompt = observationsPrompt({ summary: 'THE SUMMARY', notUseful: [], recent: ['Said before.'] });
    expect(prompt).toBe('Marked not useful:\n(none)\n\nAlready said:\n- Said before.\n\nTHE SUMMARY');
  });
});

describe('one person’s run', () => {
  function ports(overrides: Partial<ObservationRunPorts> = {}) {
    const written: ObservationRow[] = [];
    const ledger = vi.fn(async () => {});
    const observe = vi.fn<ObservationRunPorts['observe']>(async (_input, onSpend) => {
      onSpend({ model: 'claude-sonnet-5', usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } });
      return {
        model: 'claude-sonnet-5',
        observations: [
          { sentence: 'You placed 2 orders worth GBP 114.99 in the 3 days after the Acme rejection.', evidence: ['E2', 'E3', 'E4'] },
          { sentence: 'You placed 2 orders in 1 week.', evidence: ['E3', 'E4'] },
          { sentence: 'You wrote 1 note in a week with 5 interviews.', evidence: ['E1', 'E77'] },
        ],
      };
    });
    const all: ObservationRunPorts = {
      hasWeek: vi.fn(async () => false),
      timeline: vi.fn(async () => [note, rejection, order, secondOrder]),
      notUseful: vi.fn(async () => []),
      recent: vi.fn(async () => []),
      observe,
      ledger,
      write: vi.fn(async (rows: ObservationRow[]) => {
        written.push(...rows);
      }),
      ...overrides,
    };
    return { ports: all, written, ledger, observe };
  }

  it('stores only the observations that cross modules and cite real rows', async () => {
    const { ports: p, written, ledger } = ports();
    const result = await runObservationsFor(p, 'user-1', MONDAY);
    expect(result).toEqual({ status: 'written', events: 4, observations: 1, dropped: ['one-module', 'unknown-evidence'] });
    expect(written).toEqual([
      {
        user_id: 'user-1',
        week: '2026-09-28',
        position: 1,
        sentence: 'You placed 2 orders worth GBP 114.99 in the 3 days after the Acme rejection.',
        evidence: [eventRef(rejection), eventRef(order), eventRef(secondOrder)],
        modules: ['shopping', 'jobs'],
        model: 'claude-sonnet-5',
      },
    ]);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(p.timeline).toHaveBeenCalledWith('user-1', '2026-07-06T00:00:00.000Z', '2026-09-28T00:00:00.000Z');
  });

  it('sends the not-useful verdicts and does not repeat them', async () => {
    const old = 'You placed 2 orders worth GBP 114.99 in the three days after the Acme rejection.';
    const { ports: p, written, observe } = ports({ notUseful: vi.fn(async () => [old]) });
    const result = await runObservationsFor(p, 'user-1', MONDAY);
    expect(observe.mock.calls[0]![0].notUseful).toEqual([old]);
    expect(p.notUseful).toHaveBeenCalledWith('user-1', '2026-06-30T14:07:00.000Z');
    expect(result).toMatchObject({ status: 'written', observations: 0 });
    expect(written).toEqual([]);
  });

  it('does nothing in a week it has already written', async () => {
    const { ports: p, observe } = ports({ hasWeek: vi.fn(async () => true) });
    expect(await runObservationsFor(p, 'user-1', MONDAY)).toEqual({ status: 'already-run' });
    expect(observe).not.toHaveBeenCalled();
  });

  it('writes nothing when the model finds nothing', async () => {
    const { ports: p, written } = ports({ observe: vi.fn(async () => ({ model: 'claude-sonnet-5', observations: [] })) });
    expect(await runObservationsFor(p, 'user-1', MONDAY)).toMatchObject({ status: 'written', observations: 0 });
    expect(written).toEqual([]);
    expect(p.write).not.toHaveBeenCalled();
  });

  it('skips the model when there are no events', async () => {
    const { ports: p, observe } = ports({ timeline: vi.fn(async () => []) });
    expect(await runObservationsFor(p, 'user-1', MONDAY)).toEqual({ status: 'no-events' });
    expect(observe).not.toHaveBeenCalled();
  });
});
