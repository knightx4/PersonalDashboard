import { describe, expect, it } from 'vitest';
import { parseReachOutRule } from '@/lib/you/reach-out-rule';

// The same cases tests/rls-you.test.ts puts to you.reach_out_rule_valid.
const watch = {
  key: 'new_roles',
  about: 'New roles that fit you',
  tables: ['job_search.roles'],
  mode: 'each',
  every_days: 1,
  repeat_after_days: null,
};

describe('parseReachOutRule', () => {
  it('takes a well-formed rule', () => {
    expect(parseReachOutRule({ version: 1, watches: [watch], cannot_watch: ['Replies on LinkedIn'] })).toHaveProperty('rule');
    expect(
      parseReachOutRule({
        version: 1,
        watches: [
          { ...watch, key: 'roundup', mode: 'roundup', every_days: 7, repeat_after_days: 30, form: 'list' },
          { ...watch, key: 'contact', mode: 'pick', tables: ['job_search.contacts'], every_days: 14 },
        ],
      }),
    ).toHaveProperty('rule');
  });

  it('takes a fixed kind with its params and a summary either way (plan #3030.3)', () => {
    expect(
      parseReachOutRule({
        version: 1,
        watches: [
          { ...watch, key: 'charges', kind: 'charge_over', tables: ['finances.transactions'], params: { amount: 2000 } },
          { ...watch, key: 'news', kind: 'news_topics', tables: ['news.issues'], params: { words: ['AI'], days: 7, from: 'Semafor' }, always: true },
        ],
      }),
    ).toHaveProperty('rule');
  });

  it.each([
    [[]],
    [{ watches: [watch] }],
    [{ version: 2, watches: [watch] }],
    [{ version: 1, watches: [] }],
    [{ version: 1, watches: [watch], extra: true }],
    [{ version: 1, watches: [{ ...watch, colour: 'red' }] }],
    [{ version: 1, watches: [watch, watch] }],
    [{ version: 1, watches: [{ ...watch, key: 'New Roles' }] }],
    [{ version: 1, watches: [{ ...watch, about: ' ' }] }],
    [{ version: 1, watches: [{ ...watch, tables: [] }] }],
    [{ version: 1, watches: [{ ...watch, tables: ['roles'] }] }],
    [{ version: 1, watches: [{ ...watch, tables: ['job_search.roles', 'job_search.roles'] }] }],
    [{ version: 1, watches: [{ ...watch, mode: 'sometimes' }] }],
    [{ version: 1, watches: [{ ...watch, every_days: 0 }] }],
    [{ version: 1, watches: [{ ...watch, every_days: 1.5 }] }],
    [{ version: 1, watches: [{ ...watch, every_days: '7' }] }],
    [{ version: 1, watches: [{ key: 'x', about: 'x', tables: ['a.b'], mode: 'each', every_days: 1 }] }],
    [{ version: 1, watches: [{ ...watch, repeat_after_days: 0 }] }],
    [{ version: 1, watches: [{ ...watch, form: 'essay' }] }],
    [{ version: 1, watches: [watch], cannot_watch: [''] }],
    [{ version: 1, watches: [watch], cannot_watch: 'LinkedIn' }],
    [{ version: 1, watches: [{ ...watch, kind: 'Charge Over' }] }],
    [{ version: 1, watches: [{ ...watch, always: 'yes' }] }],
    [{ version: 1, watches: [{ ...watch, params: { colour: 'red' } }] }],
    [{ version: 1, watches: [{ ...watch, params: { words: [] } }] }],
    [{ version: 1, watches: [{ ...watch, params: { amount: 0 } }] }],
    [{ version: 1, watches: [{ ...watch, params: { days: 2.5 } }] }],
    [{ version: 1, watches: [{ ...watch, params: { from: ' ' } }] }],
  ])('refuses %j', (rule) => {
    expect(parseReachOutRule(rule)).toHaveProperty('error');
  });
});
