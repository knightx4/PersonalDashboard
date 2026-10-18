import { describe, expect, it } from 'vitest';
import { canCountAny, metricLine, metricLists, parseMetricForm, type MetricList } from '@/lib/goals/metric-form';
import type { Metric } from '@/lib/goals/metrics';

const lists: MetricList[] = metricLists([
  {
    id: 'jobs',
    name: 'Applications',
    fields: [
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'applied', label: 'Applied on', type: 'date' },
      { key: 'heard', label: 'Heard back', type: 'date', removed: true },
    ],
  },
  { id: 'people', name: 'Contacts', fields: [{ key: 'name', label: 'Name', type: 'text' }] },
]);

const form = (values: Record<string, string>) => (key: string) => values[key] ?? null;
const good = { name: 'Applications per week', collectionId: 'jobs', dateField: 'applied', period: 'week' };

describe('metricLists', () => {
  it('offers only the live date fields of each list', () => {
    expect(lists).toEqual([
      { id: 'jobs', name: 'Applications', dateFields: [{ key: 'applied', label: 'Applied on' }] },
      { id: 'people', name: 'Contacts', dateFields: [] },
    ]);
    expect(canCountAny(lists)).toBe(true);
    expect(canCountAny([lists[1]])).toBe(false);
  });
});

describe('parseMetricForm', () => {
  it('reads a whole form, with the target optional', () => {
    expect(parseMetricForm(form(good), lists)).toEqual({
      ok: true,
      value: { name: 'Applications per week', source: 'list', collectionId: 'jobs', dateField: 'applied', period: 'week', target: null },
    });
    const withTarget = parseMetricForm(form({ ...good, target: ' 5 ' }), lists);
    expect(withTarget.ok && withTarget.value.target).toBe(5);
  });

  it('reads a steps or files metric without a list', () => {
    expect(parseMetricForm(form({ name: 'Steps', source: 'steps', period: 'month', collectionId: 'people' }), lists)).toEqual({
      ok: true,
      value: { name: 'Steps', source: 'steps', collectionId: null, dateField: null, period: 'month', target: null },
    });
    expect(parseMetricForm(form({ ...good, source: 'files' }), lists)).toMatchObject({
      ok: true,
      value: { source: 'files', collectionId: null, dateField: null },
    });
    expect(parseMetricForm(form({ ...good, source: 'notes' }), lists)).toMatchObject({ field: 'source' });
  });

  it('puts each problem beside its field', () => {
    expect(parseMetricForm(form({ ...good, name: ' ' }), lists)).toMatchObject({ field: 'name' });
    expect(parseMetricForm(form({ ...good, collectionId: 'other' }), lists)).toMatchObject({
      field: 'collectionId',
      error: 'That list is not on this goal.',
    });
    expect(parseMetricForm(form({ ...good, collectionId: 'people' }), lists)).toMatchObject({
      field: 'collectionId',
      error: 'Contacts has no date to count by.',
    });
    expect(parseMetricForm(form({ ...good, dateField: 'heard' }), lists)).toMatchObject({
      field: 'dateField',
      error: 'That date is no longer in Applications. Choose another.',
    });
    expect(parseMetricForm(form({ ...good, period: 'day' }), lists)).toMatchObject({ field: 'period' });
    expect(parseMetricForm(form({ ...good, target: '2.5' }), lists)).toMatchObject({ field: 'target' });
    expect(parseMetricForm(form({ ...good, target: '0' }), lists)).toMatchObject({ field: 'target' });
  });
});

describe('metricLine', () => {
  const metric: Metric = {
    id: 'm1',
    goalId: 'g1',
    name: 'Applications per week',
    source: 'list',
    collectionId: 'jobs',
    dateField: 'applied',
    period: 'week',
    target: 5,
    position: 0,
  };

  it('says the list, the date, the period and the aim', () => {
    expect(metricLine(metric, lists)).toBe('Applications · Applied on · weekly · aim 5');
    expect(metricLine({ ...metric, target: null, period: 'month' }, lists)).toBe(
      'Applications · Applied on · monthly',
    );
  });

  it('names closed steps and Dash files', () => {
    const counted = { ...metric, collectionId: null, dateField: null };
    expect(metricLine({ ...counted, source: 'steps', target: 3 }, lists)).toBe('Steps closed · weekly · aim 3');
    expect(metricLine({ ...counted, source: 'files', period: 'month', target: null }, lists)).toBe('Dash files · monthly');
  });

  it('says when the list or its date is gone', () => {
    expect(metricLine({ ...metric, dateField: 'heard' }, lists)).toBe(
      'Applications · a date no longer in the list · weekly · aim 5',
    );
    expect(metricLine({ ...metric, collectionId: 'gone' }, lists)).toBe(
      'A list no longer on this goal · weekly · aim 5',
    );
  });
});
