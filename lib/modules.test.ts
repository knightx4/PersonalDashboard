import { describe, expect, it } from 'vitest';
import { moduleForPath } from '@/lib/modules';

describe('moduleForPath', () => {
  it('reads the workspace off the path', () => {
    expect(moduleForPath('/jobs/today')).toBe('jobs');
    expect(moduleForPath('/dev')).toBe('dev');
  });

  it('is null for a path outside every workspace, and for no path at all', () => {
    expect(moduleForPath('/account/settings')).toBeNull();
    expect(moduleForPath(null)).toBeNull();
  });

  it('does not mistake a longer segment for a prefix', () => {
    expect(moduleForPath('/todoist')).toBeNull();
  });
});

