import { describe, expect, it } from 'vitest';
import { idPrefixRange } from './db';
import { applyCondition } from './query';

/**
 * Connected apps cut a uuid they were given in full to its first 8
 * characters ("6a7f7286"), and Postgres refused it: "invalid input syntax
 * for type uuid" (18 November). A prefix now reads as the ids it starts.
 */

describe('idPrefixRange', () => {
  it('gives the lowest and highest id an 8-character prefix could be', () => {
    expect(idPrefixRange('6a7f7286')).toEqual([
      '6a7f7286-0000-0000-0000-000000000000',
      '6a7f7286-ffff-ffff-ffff-ffffffffffff',
    ]);
    expect(idPrefixRange('6A7F7286-45')).toEqual([
      '6a7f7286-4500-0000-0000-000000000000',
      '6a7f7286-45ff-ffff-ffff-ffffffffffff',
    ]);
  });

  it('leaves alone a whole id, a short prefix, dashes out of place and words', () => {
    for (const value of ['6a7f7286-4535-4ef4-995a-4a5adba90c90', '6a7f728', '6a7f-7286', 'Acme Corp', '6a7f7286g']) {
      expect(idPrefixRange(value)).toBeNull();
    }
  });
});

describe('applyCondition on a uuid column', () => {
  type Call = [string, ...unknown[]];
  const recorder = () => {
    const calls: Call[] = [];
    const q: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['eq', 'neq', 'gt', 'gte', 'lte', 'lt', 'in', 'is', 'not', 'ilike', 'contains', 'or']) {
      q[name] = (...args: unknown[]) => (calls.push([name, ...args]), q);
    }
    return { q: q as never, calls };
  };
  const column = (op: 'equals' | 'one_of', value: string | string[], type = 'uuid') =>
    ({ kind: 'column', column: 'application_id', op, value, type }) as const;

  it('reads an equals prefix as the span of ids it starts', () => {
    const { q, calls } = recorder();
    applyCondition(q, column('equals', '6a7f7286'));
    expect(calls).toEqual([
      ['gte', 'application_id', '6a7f7286-0000-0000-0000-000000000000'],
      ['lte', 'application_id', '6a7f7286-ffff-ffff-ffff-ffffffffffff'],
    ]);
  });

  it('reads one_of with a prefix among whole ids as either', () => {
    const whole = '9d69522d-d9e8-4d5f-acea-38f05a7349f2';
    const { q, calls } = recorder();
    applyCondition(q, column('one_of', ['6a7f7286', whole]));
    expect(calls).toEqual([
      [
        'or',
        `and(application_id.gte.6a7f7286-0000-0000-0000-000000000000,application_id.lte.6a7f7286-ffff-ffff-ffff-ffffffffffff),application_id.eq."${whole}"`,
      ],
    ]);
  });

  it('keeps whole ids, and text columns, as they were', () => {
    const { q, calls } = recorder();
    applyCondition(q, column('one_of', ['9d69522d-d9e8-4d5f-acea-38f05a7349f2']));
    applyCondition(q, column('equals', '6a7f7286', 'text'));
    expect(calls).toEqual([
      ['in', 'application_id', ['9d69522d-d9e8-4d5f-acea-38f05a7349f2']],
      ['eq', 'application_id', '6a7f7286'],
    ]);
  });
});
