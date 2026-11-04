import { describe, expect, it } from 'vitest';
import { keepView, keptHref } from './kept-view';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('kept views (note 978314f8)', () => {
  it('sends the tab back to the view the page was last showing', () => {
    const store = memory();
    keepView('/jobs/pipeline', '?view=table&sort=applied', store);
    expect(keptHref('/jobs/pipeline', store)).toBe('/jobs/pipeline?view=table&sort=applied');
  });

  it('goes to the bare page when nothing was kept, or the view was the bare page', () => {
    const store = memory();
    expect(keptHref('/jobs/pipeline', store)).toBe('/jobs/pipeline');
    keepView('/jobs/pipeline', '', store);
    expect(keptHref('/jobs/pipeline', store)).toBe('/jobs/pipeline');
  });

  it('keeps each page to its own view, and leaves an address that names one alone', () => {
    const store = memory();
    keepView('/jobs/pipeline', 'view=board', store);
    expect(keptHref('/jobs/companies', store)).toBe('/jobs/companies');
    expect(keptHref('/jobs/pipeline?view=focus', store)).toBe('/jobs/pipeline?view=focus');
  });

  it('goes to the bare page when storage throws or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => keepView('/jobs/pipeline', 'view=table', broken)).not.toThrow();
    expect(keptHref('/jobs/pipeline', broken)).toBe('/jobs/pipeline');
    expect(keptHref('/jobs/pipeline', null)).toBe('/jobs/pipeline');
  });
});
