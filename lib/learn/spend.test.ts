import { describe, expect, it } from 'vitest';
import { collectSpend, LEARN_OPERATIONS, recordLearnSpend } from './spend';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';

/**
 * How the module hands its spending to the ledger.
 *
 * The collector is trivial and the test is here for the second case: a call
 * that spent nothing must not reach for a database client at all. That is not
 * an optimisation -- recordLearnSpend runs inside server actions, and creating
 * a client outside a request context throws, so "no reports, no client" is
 * what keeps an unspent path from failing in a way its caller would feel.
 */

describe('collecting what was spent', () => {
  it('starts empty and keeps what it is given, in order', () => {
    const { sink, reports } = collectSpend();
    expect(reports).toEqual([]);

    sink({ model: 'claude-opus-5', usage: { ...EMPTY_USAGE, inputTokens: 10 } });
    sink({ model: 'claude-haiku-4-5', usage: { ...EMPTY_USAGE, outputTokens: 3 } });

    expect(reports.map((report) => report.model)).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });
});

describe('recording', () => {
  it('does nothing at all when nothing was spent', async () => {
    // No client is created, so this resolves outside a request context rather
    // than throwing on `cookies()`.
    await expect(recordLearnSpend('user-1', 'plan-topic', [])).resolves.toBeUndefined();
  });
});

describe('the operation names', () => {
  it('are unique, kebab-case, and cover every call site in the module', () => {
    // These strings are stored, and the screen groups by them. Renaming one
    // splits a month of history into two rows that look like different things.
    expect(new Set(LEARN_OPERATIONS).size).toBe(LEARN_OPERATIONS.length);
    for (const operation of LEARN_OPERATIONS) {
      expect(operation).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
    expect([...LEARN_OPERATIONS]).toEqual([
      'parse-references',
      'resolve-reference',
      'suggest-sources',
      'plan-topic',
      'name-areas',
      'locate-passage',
      'generate-chain',
      'generate-track-from-theme',
      'write-probe',
      'write-probe-ahead',
      'name-misconception',
      'propose-floor',
      'classify-note',
      'concepts-from-note',
      'concepts-from-prior',
      'concepts-from-brief',
      'branch-from-selection',
      'name-opening-claims',
      'write-opening-question',
      'grade-opening-answer',
      'write-quiz-questions',
      'grade-quiz-answer',
      'write-applied-case',
      'grade-applied-answer',
      'embed-catalogue',
      'embed-claim',
      'judge-segment',
      'map-note',
      'map-sweep',
      'check-areas',
      'place-themes',
      'place-track',
      'place-aim',
      'name-feed-material',
      'write-feed-card',
      'write-curriculum',
      'embed-map',
      'propose-theme-merges',
      'propose-position-merges',
      'link-positions',
      'write-survey-idea',
      'write-survey-question',
    ]);
  });
});
