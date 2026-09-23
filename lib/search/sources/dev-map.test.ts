import { describe, expect, it } from 'vitest';
import { devHits, firstLine, planHref } from './dev-map';

describe('dev search hits', () => {
  it('lands a step on the plan with its number in the search box', () => {
    expect(planHref(612)).toBe('/dev/plan?view=all&q=%23612');
    const [hit] = devHits({
      plan: [{ id: 'p', number: 612, title: 'Search', parent_id: 'f', status: 'not_started' }],
      ideas: [],
      notes: [],
      specs: [],
    });
    expect(hit).toMatchObject({
      module: 'dev',
      kind: 'plan',
      subtitle: 'Step #612 · not started',
      match: '#612',
    });
  });

  it('calls a step with no parent a feature', () => {
    const [hit] = devHits({
      plan: [{ id: 'p', number: 1, title: 'Plan', parent_id: null, status: 'done' }],
      ideas: [],
      notes: [],
      specs: [],
    });
    expect(hit.subtitle).toBe('Feature #1 · done');
  });

  it('sends specs to their page and ideas and notes to their row', () => {
    const hits = devHits({
      plan: [],
      specs: [{ slug: 'writing', title: 'Writing guide', blurb: 'How to write' }],
      ideas: [{ id: 'i1', body: 'An idea\nmore', module: null }],
      notes: [{ id: 'n1', body: 'It broke', kind: 'bug', status: 'in_progress' }],
    });
    expect(hits.map((hit) => hit.href)).toEqual([
      '/dev/specs/writing',
      '/dev/ideas#idea-i1',
      '/dev/bugs#note-n1',
    ]);
    expect(hits[1].title).toBe('An idea');
    expect(hits[2].subtitle).toBe('Bug · in progress');
  });

  it('shortens a long first line', () => {
    expect(firstLine('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(firstLine('   ')).toBe('Untitled');
  });
});
