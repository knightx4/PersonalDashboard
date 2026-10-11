import { describe, expect, it } from 'vitest';
import { materialHref } from './material';

describe('materialHref', () => {
  it('leaves the default part bare', () => {
    expect(materialHref('answers')).toBe('/jobs/material');
  });
  it('keeps a kind on the answers part only', () => {
    expect(materialHref('answers', 'fit')).toBe('/jobs/material?kind=fit');
    expect(materialHref('evidence', 'fit')).toBe('/jobs/material?part=evidence');
  });
});
