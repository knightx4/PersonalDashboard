import { describe, expect, it } from 'vitest';
import { fromClaim, normaliseSelection } from './branch';

/**
 * The two checks made on a selected phrase before anything is spent on it.
 *
 * Both exist because the phrase arrives from a browser: it carries whatever
 * line breaks the claim wrapped on, and it is as trustworthy as any other
 * string a form posted.
 */

const CLAIM =
  'Inflation and unemployment trade off in the short run because wage expectations\nadjust more slowly than prices.';

describe('normaliseSelection', () => {
  it('flattens the line breaks a wrapped claim puts in a selection', () => {
    expect(normaliseSelection('wage expectations\n  adjust more slowly')).toBe(
      'wage expectations adjust more slowly',
    );
  });

  it('reads a selection of nothing but whitespace as nothing', () => {
    expect(normaliseSelection(' \n ')).toBe('');
  });
});

describe('fromClaim', () => {
  it('takes a phrase out of the claim, across the line break', () => {
    expect(fromClaim('wage expectations adjust more slowly', CLAIM)).toBe(true);
  });

  it('ignores the case the claim happens to use', () => {
    expect(fromClaim('Wage Expectations', CLAIM)).toBe(true);
  });

  it('refuses a phrase that is not in the claim', () => {
    expect(fromClaim('the gold standard', CLAIM)).toBe(false);
  });

  it('refuses an empty selection, which is every unselected page', () => {
    expect(fromClaim('   ', CLAIM)).toBe(false);
  });
});
