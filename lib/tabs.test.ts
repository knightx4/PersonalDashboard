import { describe, expect, it } from 'vitest';
import { tabFrom, tabSearch, type Tab } from './tabs';

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'steps', label: 'Steps', count: 4 },
];

describe('tabFrom', () => {
  it('opens the tab the address names', () => {
    expect(tabFrom('steps', TABS)).toBe('steps');
  });

  it('opens the first tab with no value, an unknown one or a repeated one', () => {
    expect(tabFrom(undefined, TABS)).toBe('overview');
    expect(tabFrom(null, TABS)).toBe('overview');
    expect(tabFrom('', TABS)).toBe('overview');
    expect(tabFrom('nope', TABS)).toBe('overview');
    expect(tabFrom(['steps', 'activity'], TABS)).toBe('overview');
  });
});

describe('tabSearch', () => {
  it('sets the tab and keeps the other parameters', () => {
    expect(tabSearch('s=pattern-tabbed', 'steps', TABS)).toBe('?s=pattern-tabbed&tab=steps');
    expect(tabSearch('?tab=steps&s=x', 'activity', TABS)).toBe('?tab=activity&s=x');
  });

  it('drops the parameter for the first tab', () => {
    expect(tabSearch('tab=steps', 'overview', TABS)).toBe('');
    expect(tabSearch('s=x&tab=steps', 'overview', TABS)).toBe('?s=x');
  });
});
