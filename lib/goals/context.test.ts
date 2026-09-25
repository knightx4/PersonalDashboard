import { describe, expect, it } from 'vitest';
import { contextTitle, shownContext, toContextItem, type ContextRow } from './context';
import { appSource, sourceHref, sourceLabel } from './information';

function row(overrides: Partial<ContextRow>): ContextRow {
  return {
    id: 'c1',
    source: 'obsidian.notes',
    ref: 'Career/What I want.md',
    title: 'What I want',
    why: 'Says what you want from the next role.',
    excerpt: null,
    status: 'proposed',
    ...overrides,
  };
}

describe('context on a goal', () => {
  it('names the module and links the row from the catalogue', () => {
    const item = toContextItem(row({}));
    expect(item).toMatchObject({ module: 'Vault', weight: 'intent', href: '/vault/n/Career/What%20I%20want.md' });
    const unknown = toContextItem(row({ source: 'cashflow.deals', ref: 'd1' }));
    expect(unknown).toMatchObject({ module: 'cashflow', weight: 'record', href: null });
  });

  it('leaves out what was dismissed and puts what they said they want first', () => {
    const shown = shownContext(
      [
        row({ id: 'app', source: 'job_search.applications', ref: 'a1', title: 'Apply', status: 'kept' }),
        row({ id: 'gone', status: 'dismissed' }),
        row({ id: 'thought', source: 'job_search.thoughts', ref: 't1', title: 'Thoughts', status: 'kept' }),
        row({ id: 'note', title: 'Note' }),
      ].map(toContextItem),
    );
    expect(shown.map((c) => c.id)).toEqual(['note', 'thought', 'app']);
  });

  it('shortens a long or multi-line title to one line', () => {
    expect(contextTitle('First line\nsecond')).toBe('First line');
    expect(contextTitle('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('a draft filled from another module', () => {
  it('reads its table and row from source_ref', () => {
    expect(appSource('job_search.thoughts:abc')).toEqual({ table: 'job_search.thoughts', ref: 'abc' });
    expect(appSource('obsidian.notes:Career/What I want.md')).toEqual({
      table: 'obsidian.notes',
      ref: 'Career/What I want.md',
    });
    expect(appSource('not a ref')).toBeNull();
  });

  it('says which module it came from and links back to it', () => {
    expect(sourceLabel('app', 'job_search.roles:r1')).toBe('From Job search');
    expect(sourceHref('app', 'job_search.roles:r1')).toBe('/jobs/roles/r1');
    expect(sourceLabel('app', null)).toBe('From another module');
  });
});
