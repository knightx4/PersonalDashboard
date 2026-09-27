import { describe, expect, it } from 'vitest';
import { evidenceByTable, showObservations, weekLabel, type ObservationRecord } from './observations-view';
import type { TimelineEvent } from './timeline';

function event(source_table: string, source_id: string, occurred_at: string, module: TimelineEvent['module']): TimelineEvent {
  return {
    occurred_at,
    module,
    kind: module === 'shopping' ? 'ordered' : 'rejected',
    title: source_id,
    detail: null,
    amount_cents: null,
    currency: null,
    source_table,
    source_id,
    link_ref: null,
  };
}

function record(overrides: Partial<ObservationRecord>): ObservationRecord {
  return {
    id: 'o1',
    week: '2026-09-21',
    position: 1,
    sentence: 'You placed 4 orders in the week after each of 2 rejections.',
    evidence: ['public.orders:a', 'job_search.application_events:b'],
    modules: ['jobs', 'shopping'],
    verdict: null,
    ...overrides,
  };
}

describe('evidenceByTable', () => {
  it('groups ids by table, once each, and skips what is not a ref', () => {
    const grouped = evidenceByTable([
      record({ evidence: ['public.orders:a', 'public.orders:b', 'nonsense'] }),
      record({ id: 'o2', evidence: ['public.orders:a', 'todo.tasks:t'] }),
    ]);
    expect(Object.fromEntries(grouped)).toEqual({ 'public.orders': ['a', 'b'], 'todo.tasks': ['t'] });
  });
});

describe('showObservations', () => {
  const events = [
    event('public.orders', 'a', '2026-09-10T10:00:00Z', 'shopping'),
    event('job_search.application_events', 'b', '2026-09-12T10:00:00Z', 'jobs'),
  ];

  it('leaves out one marked not useful and keeps one marked useful', () => {
    const shown = showObservations(
      [record({ id: 'gone', verdict: 'not_useful' }), record({ id: 'kept', position: 2, verdict: 'useful' })],
      events,
    );
    expect(shown.map((o) => o.id)).toEqual(['kept']);
  });

  it('orders newest week first, then by position', () => {
    const shown = showObservations(
      [
        record({ id: 'old', week: '2026-09-14' }),
        record({ id: 'second', position: 2 }),
        record({ id: 'first', position: 1 }),
      ],
      events,
    );
    expect(shown.map((o) => o.id)).toEqual(['first', 'second', 'old']);
  });

  it('finds the evidence rows, newest first, and drops refs that have gone', () => {
    const [shown] = showObservations(
      [record({ evidence: ['public.orders:a', 'job_search.application_events:b', 'public.orders:deleted'] })],
      events,
    );
    expect(shown.events.map((e) => e.source_id)).toEqual(['b', 'a']);
  });

  it('keeps only modules the timeline knows, in its order', () => {
    const [shown] = showObservations([record({ modules: ['shopping', 'nope', 'jobs'] })], events);
    expect(shown.modules).toEqual(['shopping', 'jobs']);
  });

  it('is empty for a week with nothing to say', () => {
    expect(showObservations([], events)).toEqual([]);
  });
});

describe('weekLabel', () => {
  it('names the Monday', () => {
    expect(weekLabel('2026-09-21')).toBe('Week of 21 September');
  });
});
