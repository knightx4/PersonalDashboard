import { describe, expect, it } from 'vitest';
import { activeFilters, clearedHref, otherParams, parseOpeningView } from './opening-view';
import { NO_OPENING_FILTER } from './scores';

describe('parseOpeningView', () => {
  it('reads nothing as the defaults', () => {
    expect(parseOpeningView({})).toEqual({ sort: 'newest', filter: NO_OPENING_FILTER });
  });

  it('reads each parameter', () => {
    const view = parseOpeningView({
      rsort: 'chance',
      rwork: 'remote',
      rmatch: 'strong',
      rpay: 'shown',
      rletter: 'no',
      rfit: '60',
      rchance: 'medium',
      rflags: 'hide',
      rfile: 'hide',
    });
    expect(view).toEqual({
      sort: 'chance',
      filter: {
        workplace: 'remote',
        fit: 'strong',
        salary: true,
        coverLetter: 'no',
        minFit: 60,
        minChance: 'medium',
        hideRedFlags: true,
        hideDuplicates: true,
      },
    });
    expect(activeFilters(view.filter)).toBe(8);
  });

  it('turns anything unreadable into the default', () => {
    const view = parseOpeningView({ rsort: 'best', rwork: 'unclear', rfit: '55', rchance: 'low' });
    expect(view).toEqual({ sort: 'newest', filter: NO_OPENING_FILTER });
  });
});

describe('otherParams and clearedHref', () => {
  it('keep the table’s parameters and drop the section’s', () => {
    const params = { status: 'submitted', hide: ['a', 'b'], rsort: 'chance', rpay: 'shown' };
    expect(otherParams(params)).toEqual([
      ['status', 'submitted'],
      ['hide', 'a'],
      ['hide', 'b'],
    ]);
    expect(clearedHref('/jobs/roles', params)).toBe('/jobs/roles?status=submitted&hide=a&hide=b');
    expect(clearedHref('/jobs/roles', { rsort: 'chance' })).toBe('/jobs/roles');
  });
});
