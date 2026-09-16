import { describe, expect, it } from 'vitest';
import { askedBeforeRewrite, isSameClaim, rewriteClaimPatch } from './rewrite';

/**
 * The first rewrite is the one that keeps something. Everything after it is
 * one sentence of yours replacing another, and the copy of the app's wording
 * has to survive all of them.
 */

const APP_WORDING = 'Inflation and unemployment trade off in the short run.';
const AT = new Date('2026-09-16T10:00:00.000Z');

describe('rewriteClaimPatch', () => {
  it('keeps the wording it is replacing, the first time', () => {
    const patch = rewriteClaimPatch(
      { claim: APP_WORDING, claimOriginal: null },
      'Prices move before wages do, so a boom looks cheap for a while.',
      AT,
    );

    expect(patch.claim).toBe('Prices move before wages do, so a boom looks cheap for a while.');
    expect(patch.claim_original).toBe(APP_WORDING);
    expect(patch.claim_rewritten_at).toBe('2026-09-16T10:00:00.000Z');
  });

  it('leaves the kept copy alone on every rewrite after that', () => {
    const patch = rewriteClaimPatch(
      { claim: 'A sentence I wrote last week.', claimOriginal: APP_WORDING },
      'A better sentence I wrote today.',
      AT,
    );

    // Absent rather than null: the update must not touch the column, and a
    // null would clear the only copy of what the app wrote.
    expect('claim_original' in patch).toBe(false);
    expect(patch.claim).toBe('A better sentence I wrote today.');
    expect(patch.claim_rewritten_at).toBe('2026-09-16T10:00:00.000Z');
  });

  it('trims what it writes, and keeps what it replaces as it stood', () => {
    const patch = rewriteClaimPatch(
      { claim: APP_WORDING, claimOriginal: null },
      '  Wages are slow.  ',
      AT,
    );

    expect(patch.claim).toBe('Wages are slow.');
    expect(patch.claim_original).toBe(APP_WORDING);
  });
});

describe('isSameClaim', () => {
  it('reads a save that only changed the whitespace as no change', () => {
    expect(isSameClaim(APP_WORDING, `  ${APP_WORDING}\n`)).toBe(true);
  });

  it('reads a different sentence as a different sentence', () => {
    expect(isSameClaim(APP_WORDING, 'Something else entirely.')).toBe(false);
  });
});

describe('askedBeforeRewrite', () => {
  it('says no about every question when the claim is still the app\u2019s', () => {
    expect(askedBeforeRewrite('2026-09-13T09:00:00Z', null)).toBe(false);
  });

  it('marks a question asked before the last rewrite', () => {
    expect(askedBeforeRewrite('2026-09-13T09:00:00Z', '2026-09-16T10:00:00.000Z')).toBe(true);
  });

  it('leaves a question asked since the rewrite alone', () => {
    expect(askedBeforeRewrite('2026-09-16T11:00:00Z', '2026-09-16T10:00:00.000Z')).toBe(false);
  });

  it('compares the instants, not the way they are written', () => {
    // The same moment written two ways: asked exactly when it was rewritten
    // is not asked before it.
    expect(askedBeforeRewrite('2026-09-16T12:00:00+02:00', '2026-09-16T10:00:00.000Z')).toBe(false);
    // 09:00Z, half an hour before the rewrite -- and later than it as text,
    // which is what comparing the strings would have got wrong.
    expect(askedBeforeRewrite('2026-09-16T11:00:00+02:00', '2026-09-16T09:30:00.000Z')).toBe(true);
  });

  it('says no when either date will not parse', () => {
    expect(askedBeforeRewrite('not a date', '2026-09-16T10:00:00.000Z')).toBe(false);
    expect(askedBeforeRewrite('2026-09-13T09:00:00Z', 'not a date')).toBe(false);
  });
});
