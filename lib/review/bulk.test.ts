import { describe, expect, it } from 'vitest';
import { reviewSelectionTargets } from './bulk';
import type { ReviewRow } from './load';

const order = (id: string): ReviewRow =>
  ({ kind: 'order', id: `order:${id}`, orderId: id }) as ReviewRow;
const email = (id: string): ReviewRow =>
  ({ kind: 'email', id: `email:${id}`, messageId: id }) as ReviewRow;

const rows = [order('o1'), email('m1'), order('o2'), email('m2')];
const selecting =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);

describe('reviewSelectionTargets', () => {
  it('splits a mixed selection into what each verb would touch', () => {
    expect(reviewSelectionTargets(rows, selecting('order:o1', 'email:m2', 'order:o2'))).toEqual({
      orderIds: ['o1', 'o2'],
      emailIds: ['m2'],
    });
  });

  it('gives the order verbs nothing when only emails are ticked', () => {
    expect(reviewSelectionTargets(rows, selecting('email:m1'))).toEqual({
      orderIds: [],
      emailIds: ['m1'],
    });
  });

  it('reads the row order, not the order rows were ticked in', () => {
    expect(reviewSelectionTargets(rows, selecting('order:o2', 'order:o1')).orderIds).toEqual([
      'o1',
      'o2',
    ]);
  });

  it('is empty for an empty selection', () => {
    expect(reviewSelectionTargets(rows, () => false)).toEqual({ orderIds: [], emailIds: [] });
  });
});
